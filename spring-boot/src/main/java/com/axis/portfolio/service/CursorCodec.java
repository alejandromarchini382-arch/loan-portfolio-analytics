package com.axis.portfolio.service;
import com.axis.portfolio.config.PortfolioProperties;
import com.axis.portfolio.dto.Responses.Meta;
import com.axis.portfolio.dto.Responses.Loan;
import com.axis.portfolio.exception.ApiProblem;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.Clock;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;
@Component
public class CursorCodec {
    public record Position(String tenant,String fingerprint,String number,String id,long expires,long version,String asOf,String riskRun) {}
    private final ObjectMapper json; private final byte[] secret; private final Clock clock; private final int lifetime;
    @org.springframework.beans.factory.annotation.Autowired
    public CursorCodec(ObjectMapper json,PortfolioProperties p) { this(json,p.cursorSecret(),p.cursorSeconds(),Clock.systemUTC()); }
    public CursorCodec(ObjectMapper json,String secret,int lifetime,Clock clock) {
        this.json=json;this.secret=secret.getBytes(StandardCharsets.UTF_8);this.lifetime=lifetime;this.clock=clock;
    }
    public String fingerprint(ReportQuery query) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(json.writeValueAsBytes(query.canonical()))); }
        catch(Exception ex) { throw new IllegalStateException("Cannot encode query fingerprint"); }
    }
    public String encode(String tenant,ReportQuery query,Meta meta,Loan last) {
        try {
            var body=new Position(tenant,fingerprint(query),last.loanNumber(),last.loanId(),clock.instant().getEpochSecond()+lifetime,
                meta.snapshotVersion(),meta.asOfUtc(),meta.riskRunId());
            String payload=Base64.getUrlEncoder().withoutPadding().encodeToString(json.writeValueAsBytes(body));
            return payload+"."+Base64.getUrlEncoder().withoutPadding().encodeToString(mac(payload));
        } catch(Exception ex) { throw new IllegalStateException("Cannot encode cursor"); }
    }
    public Position decode(String token,String tenant,ReportQuery query) {
        if(token==null) return null;
        try {
            if(token.length()>8192) throw new IllegalArgumentException();
            String[] parts=token.split("\\.",-1);
            if(parts.length!=2 || !MessageDigest.isEqual(mac(parts[0]),Base64.getUrlDecoder().decode(parts[1]))) throw new IllegalArgumentException();
            Position p=json.readValue(Base64.getUrlDecoder().decode(parts[0]),Position.class);
            if(!tenant.equals(p.tenant()) || !fingerprint(query).equals(p.fingerprint()) || p.expires()<=clock.instant().getEpochSecond()
                || p.number()==null || p.number().length()>50 || p.version()<0) throw new IllegalArgumentException();
            PortfolioProperties.uuid(p.id());
            return p;
        } catch(Exception ex) { throw ApiProblem.bad("INVALID_CURSOR"); }
    }
    public void checkVersion(Position p,Meta meta) {
        if(p!=null && (p.version()!=meta.snapshotVersion() || !Objects.equals(p.asOf(),meta.asOfUtc()) || !Objects.equals(p.riskRun(),meta.riskRunId())))
            throw new ApiProblem(409,"SNAPSHOT_CHANGED");
    }
    private byte[] mac(String value) throws GeneralSecurityException {
        Mac mac=Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(secret,"HmacSHA256"));
        return mac.doFinal(value.getBytes(StandardCharsets.UTF_8));
    }
}
