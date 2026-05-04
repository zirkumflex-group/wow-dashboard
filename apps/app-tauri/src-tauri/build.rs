fn main() {
    println!(
        "cargo:rustc-env=VITE_API_URL={}",
        env_or_default("VITE_API_URL", "http://localhost:3000/api")
    );
    println!(
        "cargo:rustc-env=VITE_SITE_URL={}",
        env_or_default("VITE_SITE_URL", "http://localhost:3001")
    );
    tauri_build::build();
}

fn env_or_default(name: &str, default_value: &str) -> String {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default_value.to_string())
}
