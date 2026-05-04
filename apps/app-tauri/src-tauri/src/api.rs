use anyhow::{Context, Result, anyhow};
use reqwest::{Client, Method, header::HeaderMap};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::json;
use tauri::State;
use url::Url;

#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub api_url: Url,
    pub site_url: Url,
}

impl RuntimeConfig {
    pub fn from_env() -> Result<Self> {
        let api_url = Url::parse(env!("VITE_API_URL")).context("invalid VITE_API_URL")?;
        let site_url = Url::parse(env!("VITE_SITE_URL")).context("invalid VITE_SITE_URL")?;
        validate_http_base(&api_url).context("VITE_API_URL must be http(s)")?;
        validate_http_base(&site_url).context("VITE_SITE_URL must be http(s)")?;
        Ok(Self { api_url, site_url })
    }

    pub fn api_endpoint(&self, path: &str) -> Result<Url> {
        let base = if self.api_url.path().ends_with('/') {
            self.api_url.clone()
        } else {
            Url::parse(&format!("{}/", self.api_url.as_str())).context("invalid API base")?
        };
        base.join(path.trim_start_matches('/'))
            .with_context(|| format!("invalid API path: {path}"))
    }

    pub fn site_endpoint(&self, path: &str) -> Result<Url> {
        self.site_url
            .join(path.trim_start_matches('/'))
            .with_context(|| format!("invalid site path: {path}"))
    }

    pub fn is_trusted_api_url(&self, candidate: &Url) -> bool {
        let mut base = self.api_url.clone();
        if !base.path().ends_with('/') {
            base.set_path(&format!("{}/", base.path()));
        }
        candidate.scheme() == base.scheme()
            && candidate.host_str() == base.host_str()
            && candidate.port_or_known_default() == base.port_or_known_default()
            && (candidate.path() == base.path().trim_end_matches('/')
                || candidate.path().starts_with(base.path()))
    }
}

fn validate_http_base(url: &Url) -> Result<()> {
    match url.scheme() {
        "https" | "http" => Ok(()),
        scheme => Err(anyhow!("unsupported URL scheme: {scheme}")),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFetchRequest {
    pub url: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: Option<Vec<(String, String)>>,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFetchResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

pub fn bearer_headers(config: &RuntimeConfig, token: Option<&str>) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        "Origin",
        config
            .site_url
            .as_str()
            .parse()
            .expect("validated site URL should be a header value"),
    );
    if let Some(token) = token {
        if let Ok(value) = format!("Bearer {token}").parse() {
            headers.insert(reqwest::header::AUTHORIZATION, value);
        }
    }
    headers
}

pub async fn request_json<T: DeserializeOwned>(
    client: &Client,
    config: &RuntimeConfig,
    token: Option<&str>,
    method: Method,
    path: &str,
    body: Option<serde_json::Value>,
) -> Result<T> {
    let url = config.api_endpoint(path)?;
    let mut request = client
        .request(method, url)
        .headers(bearer_headers(config, token));
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!("API request failed with status {status}: {text}"));
    }
    serde_json::from_str(&text).context("failed to parse API response")
}

pub async fn post_empty(
    client: &Client,
    config: &RuntimeConfig,
    token: Option<&str>,
    path: &str,
) -> Result<serde_json::Value> {
    request_json(client, config, token, Method::POST, path, Some(json!({}))).await
}

#[tauri::command]
pub async fn api_fetch(
    state: State<'_, crate::AppState>,
    request: ApiFetchRequest,
) -> Result<ApiFetchResponse, String> {
    let parsed_url = Url::parse(&request.url).map_err(|_| "Blocked invalid API URL".to_string())?;
    if !state.config.is_trusted_api_url(&parsed_url) {
        return Err("Blocked untrusted API request".to_string());
    }

    let method = request
        .method
        .as_deref()
        .unwrap_or("GET")
        .to_uppercase()
        .parse::<Method>()
        .map_err(|_| "Blocked unsupported API method".to_string())?;
    if !matches!(method, Method::GET | Method::POST | Method::PATCH) {
        return Err(format!("Blocked unsupported API method: {method}"));
    }

    let token = state.auth_token().map_err(|error| error.to_string())?;
    let mut headers = bearer_headers(&state.config, token.as_deref());
    for (name, value) in request.headers.unwrap_or_default() {
        let normalized = name.to_ascii_lowercase();
        if (normalized == "accept" || normalized == "content-type")
            && let Ok(header_name) = name.parse::<reqwest::header::HeaderName>()
            && let Ok(header_value) = value.parse()
        {
            headers.insert(header_name, header_value);
        }
    }

    let mut builder = state
        .client
        .request(method.clone(), parsed_url)
        .headers(headers);
    if method != Method::GET
        && let Some(body) = request.body
    {
        builder = builder.body(body);
    }

    let response = builder.send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let status_text = status.canonical_reason().unwrap_or("").to_string();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.as_str().to_string(), value.to_string()))
        })
        .collect();
    let body = response.text().await.map_err(|error| error.to_string())?;

    Ok(ApiFetchResponse {
        status: status.as_u16(),
        status_text,
        headers,
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trusted_api_url_must_match_origin_and_base_path() {
        let config = RuntimeConfig {
            api_url: Url::parse("https://example.test/api").unwrap(),
            site_url: Url::parse("https://example.test").unwrap(),
        };
        assert!(
            config
                .is_trusted_api_url(&Url::parse("https://example.test/api/addon/ingest").unwrap())
        );
        assert!(
            !config.is_trusted_api_url(&Url::parse("https://evil.test/api/addon/ingest").unwrap())
        );
        assert!(!config.is_trusted_api_url(&Url::parse("https://example.test/other").unwrap()));
    }
}
