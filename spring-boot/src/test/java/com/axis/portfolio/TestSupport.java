package com.axis.portfolio;
import com.axis.portfolio.config.PortfolioProperties;
import com.axis.portfolio.dto.Responses.*;
import java.time.*;
import java.util.*;
import com.nimbusds.jose.*;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.*;
final class TestSupport {
    static final String A="2668d56c-d696-50e6-b98b-79dae5d65c7c",B="f1c9c744-05ce-537b-b653-d7fbe822f077";
    static final String JWT_KEY="j".repeat(48),CURSOR_KEY="c".repeat(48);
    static PortfolioProperties properties() {
        return new PortfolioProperties("development-jwt",JWT_KEY,"axis-test","axis-audience",A+","+B,CURSOR_KEY,
            "host",1433,"database","portfolio_reader","test-only-placeholder",true,5,900,120,"http://localhost:8080","http://localhost:8000");
    }
    static Loan loan() {
        return new Loan("00000000-0000-0000-0000-000000000001","LN-000001","Fictional","INDIVIDUAL",null,"Commercial","Demo Officer",
            "1000.00","500.00","0.07250000","ACTIVE","2024-01-01","2029-01-01",0,null,null,null);
    }
    static String token(String tenant,List<String> permissions,String variant) throws Exception {
        Instant now=Instant.now();
        JWTClaimsSet.Builder claims=new JWTClaimsSet.Builder().subject("tester").issuer("issuer".equals(variant)?"other":"axis-test")
            .audience("audience".equals(variant)?"other":"axis-audience").issueTime(Date.from("future".equals(variant)?now.plusSeconds(300):now.minusSeconds(2)))
            .expirationTime(Date.from("expired".equals(variant)?now.minusSeconds(2):now.plusSeconds(120)))
            .claim("tenantId",tenant).claim("permissions",permissions);
        if("not-before".equals(variant)) claims.notBeforeTime(Date.from(now.plusSeconds(300)));
        if("missing-exp".equals(variant)) claims.expirationTime(null);
        if("missing-iat".equals(variant)) claims.issueTime(null);
        if("bad-permissions".equals(variant)) claims.claim("permissions","portfolio:read");
        if("bad-tenant".equals(variant)) claims.claim("tenantId","not-a-uuid");
        JWSAlgorithm algorithm="algorithm".equals(variant)?JWSAlgorithm.HS384:JWSAlgorithm.HS256;
        SignedJWT jwt=new SignedJWT(new JWSHeader(algorithm),claims.build());
        jwt.sign(new MACSigner("signature".equals(variant)?"x".repeat(48):JWT_KEY));
        return jwt.serialize();
    }
}
