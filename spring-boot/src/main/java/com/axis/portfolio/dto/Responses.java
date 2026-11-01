package com.axis.portfolio.dto;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
public final class Responses {
    private Responses() {}
    public record Meta(long snapshotVersion,String riskRunId,String asOfUtc) {}
    public record Group(String key,String label,long loanCount,String totalBalance,String averageInterestRate,boolean hasChildren) {}
    public record Parent(String dimension,String key) {}
    public record GroupResponse(String groupBy,String subgroupBy,@JsonInclude(JsonInclude.Include.NON_NULL) Parent parent,
        long snapshotVersion,String riskRunId,String asOfUtc,String currency,String rateUnit,String requestId,List<Group> groups) {}
    public record Loan(String loanId,String loanNumber,String borrowerName,String borrowerType,String industry,String division,
        String loanOfficer,String principalAmount,String currentBalance,String interestRate,String status,String originationDate,
        String maturityDate,int daysPastDue,String lastPaymentDate,String borrowerRiskRating,String loanRiskRating) {}
    public record LoanResponse(long snapshotVersion,String riskRunId,String asOfUtc,String currency,String rateUnit,
        String requestId,List<Loan> loans,String nextCursor) {}
}
