package com.axis.portfolio.security;
import com.axis.portfolio.exception.ApiProblem;
import java.time.Clock;
import java.util.concurrent.ConcurrentHashMap;
public class TenantRateLimit {
    private record Window(long minute,int count) {}
    private final ConcurrentHashMap<String,Window> windows=new ConcurrentHashMap<>();
    private final int maximum;
    private final Clock clock;
    public TenantRateLimit(int maximum,Clock clock) { this.maximum=maximum; this.clock=clock; }
    public void check(String tenant) {
        long minute=clock.instant().getEpochSecond()/60;
        Window window=windows.compute(tenant,(id,old)-> old==null || old.minute()!=minute ? new Window(minute,1) : new Window(minute,old.count()+1));
        if(window.count()>maximum) throw new ApiProblem(429,"RATE_LIMIT_EXCEEDED");
    }
}
