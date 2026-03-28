window.APP_CONFIG = {
    localApiBaseUrl: 'http://localhost:3000',
    productionApiBaseUrl: 'https://finance-app-production-3a22.up.railway.app',
    githubPagesHosts: ['ligexiao2009.github.io'],
};

function resolveApiBaseUrl() {
    const { protocol, hostname, origin } = window.location;

    if (protocol === 'file:') {
        return window.APP_CONFIG.localApiBaseUrl;
    }

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return origin;
    }

    if (window.APP_CONFIG.githubPagesHosts.includes(hostname)) {
        return window.APP_CONFIG.productionApiBaseUrl;
    }

    return window.APP_CONFIG.productionApiBaseUrl;
}

window.API_BASE_URL = resolveApiBaseUrl();
