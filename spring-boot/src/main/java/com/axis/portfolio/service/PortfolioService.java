package com.axis.portfolio.service;
import com.axis.portfolio.dto.Responses.*;
import com.axis.portfolio.repository.PortfolioRepository;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.util.MultiValueMap;
@Service
public class PortfolioService {
    private final PortfolioRepository repository; private final CursorCodec cursors;
    public PortfolioService(PortfolioRepository repository,CursorCodec cursors) { this.repository=repository;this.cursors=cursors; }
    public Map<String,Object> metadata() {
        return Map.of("dimensions",Arrays.stream(ReportQuery.Dimension.values()).map(d->Map.of("value",d.value,"label",d.label)).toList(),
            "maxDepth",2,"defaultStatus","ACTIVE","defaultLimit",50,"maxLimit",100,"currency","USD","rateUnit","fractionPerYear");
    }
    public GroupResponse groups(String tenant,ReportQuery.Kind kind,MultiValueMap<String,String> params,String requestId) {
        ReportQuery q=ReportQuery.parse(kind,params);
        var result=repository.query(tenant,q,null); Meta m=result.meta();
        Parent parent=kind==ReportQuery.Kind.CHILDREN?new Parent(q.group().value,q.key()):null;
        return new GroupResponse(q.group().value,q.subgroup()==null?null:q.subgroup().value,parent,m.snapshotVersion(),m.riskRunId(),m.asOfUtc(),
            "USD","fractionPerYear",requestId,result.groups());
    }
    public LoanResponse loans(String tenant,MultiValueMap<String,String> params,String requestId) {
        ReportQuery q=ReportQuery.parse(ReportQuery.Kind.LOANS,params);
        var position=cursors.decode(q.cursor(),tenant,q);
        var result=repository.query(tenant,q,position); Meta m=result.meta(); cursors.checkVersion(position,m);
        List<Loan> page=result.loans(); String next=null;
        if(page.size()>q.limit()) { page=List.copyOf(page.subList(0,q.limit())); next=cursors.encode(tenant,q,m,page.get(page.size()-1)); }
        return new LoanResponse(m.snapshotVersion(),m.riskRunId(),m.asOfUtc(),"USD","fractionPerYear",requestId,page,next);
    }
}
