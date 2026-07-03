export interface ProfileQuota {
    used: number;
    total: number;
    expire: number;
}

// Thin re-export barrel. The implementations now live in focused domain modules
// under src/utils/; these re-exports keep existing '@/utils' import paths valid
// (audit D7-26 / D9-07).
export { getSingBoxUserAgent } from './utils/user-agent';
export { fetchWithTimeout } from './utils/fetch-with-timeout';
export { deriveProfileNameFromUrl } from './utils/url-info';
