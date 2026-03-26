import { FastResponse } from "srvx";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

globalThis.Response = FastResponse;

//sdsdsd
export default createServerEntry({
    fetch(request) {
        return handler.fetch(request);
    },
});