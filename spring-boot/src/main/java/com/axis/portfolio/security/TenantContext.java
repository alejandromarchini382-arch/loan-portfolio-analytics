package com.axis.portfolio.security;
import com.axis.portfolio.config.PortfolioProperties;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
public final class TenantContext {
    private TenantContext() {}
    public static String tenant(Authentication authentication) {
        return PortfolioProperties.uuid(((JwtAuthenticationToken)authentication).getToken().getClaimAsString("tenantId"));
    }
}
