window.APP_CONFIG = {
    localApiBaseUrl: 'http://localhost:4000',
    productionApiBaseUrl: 'https://finance-app-kanh.onrender.com',
    githubPagesHosts: ['ligexiao2009.github.io'],
};

function resolveApiBaseUrl() {
    const { protocol, hostname, origin } = window.location;

    if (protocol === 'file:') {
        return window.APP_CONFIG.localApiBaseUrl;
    }

    // GitHub Pages 静态部署，API 走生产服务器
    if (window.APP_CONFIG.githubPagesHosts.includes(hostname)) {
        return window.APP_CONFIG.productionApiBaseUrl;
    }

    // 其他情况（localhost / 局域网IP / 容器）直接用当前地址
    return origin;
}

window.API_BASE_URL = resolveApiBaseUrl();
