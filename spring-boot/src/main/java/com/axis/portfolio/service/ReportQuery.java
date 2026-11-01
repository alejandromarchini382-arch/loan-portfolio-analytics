package com.axis.portfolio.service;
import com.axis.portfolio.exception.ApiProblem;
import java.time.LocalDate;
import java.util.*;
import org.springframework.util.MultiValueMap;
public record ReportQuery(Kind kind,Dimension group,Dimension subgroup,String status,String division,String borrowerType,
    String riskRating,LocalDate from,LocalDate to,String key,boolean nullKey,String subkey,boolean nullSubkey,
    int limit,String cursor,SortedMap<String,String> canonical) {
    public enum Kind { GROUPS, CHILDREN, LOANS }
    public enum Dimension {
        DIVISION("division","Division","Division",100), OFFICER("loanOfficer","LoanOfficer","Loan officer",150),
        BORROWER("borrowerType","BorrowerType","Borrower type",20), RISK("riskRating","LoanRiskRating","Loan risk rating",10);
        public final String value,column,label; public final int length;
        Dimension(String value,String column,String label,int length) { this.value=value;this.column=column;this.label=label;this.length=length; }
        public static Dimension parse(String value) {
            return Arrays.stream(values()).filter(d->d.value.equals(value)).findFirst().orElseThrow(()->ApiProblem.bad("INVALID_GROUP_BY"));
        }
    }
    private static final Set<String> BASE=Set.of("groupBy","subgroupBy","status","division","borrowerType","riskRating","originationFrom","originationTo");
    public static ReportQuery parse(Kind kind,MultiValueMap<String,String> params) {
        Set<String> allowed=new HashSet<>(BASE);
        if(kind==Kind.CHILDREN) allowed.addAll(Set.of("parentKey","parentKeyIsNull"));
        if(kind==Kind.LOANS) allowed.addAll(Set.of("groupKey","groupKeyIsNull","subgroupKey","subgroupKeyIsNull","limit","cursor"));
        SortedMap<String,String> values=new TreeMap<>();
        params.forEach((name,list)->{
            if(!allowed.contains(name) || list.size()!=1 || list.get(0)==null || list.get(0).length()>8192)
                throw ApiProblem.bad("INVALID_PARAMETER");
            values.put(name,list.get(0));
        });
        Dimension group=Dimension.parse(values.get("groupBy"));
        Dimension sub=values.containsKey("subgroupBy")?Dimension.parse(values.get("subgroupBy")):null;
        if(sub==group || (kind==Kind.CHILDREN && sub==null)) throw ApiProblem.bad("INVALID_GROUP_PATH");
        String status=values.getOrDefault("status","ACTIVE");
        enumeration(status,Set.of("ACTIVE","CLOSED","DEFAULTED"));
        String division=values.get("division"),borrower=values.get("borrowerType"),risk=values.get("riskRating");
        text(division,100); enumeration(borrower,Set.of("INDIVIDUAL","CORPORATE")); enumeration(risk,Set.of("HIGH","MEDIUM","LOW"));
        LocalDate from=date(values.get("originationFrom")),to=date(values.get("originationTo"));
        if(from!=null && to!=null && from.isAfter(to)) throw ApiProblem.bad("INVALID_DATE_RANGE");
        String key=null,subkey=null; boolean nullKey=false,nullSubkey=false;
        if(kind==Kind.CHILDREN) { key=values.get("parentKey"); nullKey=flag(values.get("parentKeyIsNull")); pathKey(group,key,nullKey); }
        if(kind==Kind.LOANS) {
            key=values.get("groupKey"); nullKey=flag(values.get("groupKeyIsNull")); pathKey(group,key,nullKey);
            subkey=values.get("subgroupKey"); nullSubkey=flag(values.get("subgroupKeyIsNull"));
            if(sub!=null) pathKey(sub,subkey,nullSubkey);
            else if(values.containsKey("subgroupKey") || values.containsKey("subgroupKeyIsNull")) throw ApiProblem.bad("INVALID_GROUP_PATH");
        }
        int limit=50;
        try { if(values.containsKey("limit")) { if(!values.get("limit").matches("[0-9]{1,3}")) throw new NumberFormatException(); limit=Integer.parseInt(values.get("limit")); } }
        catch(NumberFormatException ex) { throw ApiProblem.bad("INVALID_LIMIT"); }
        if(limit<1 || limit>100) throw ApiProblem.bad("INVALID_LIMIT");
        String cursor=values.get("cursor"); if(cursor!=null && cursor.isBlank()) throw ApiProblem.bad("INVALID_CURSOR");
        values.remove("cursor"); values.put("status",status); if(kind==Kind.LOANS) values.put("limit",Integer.toString(limit));
        return new ReportQuery(kind,group,sub,status,division,borrower,risk,from,to,key,nullKey,subkey,nullSubkey,limit,cursor,
            Collections.unmodifiableSortedMap(values));
    }
    private static void pathKey(Dimension dim,String key,boolean isNull) {
        if((key!=null)==isNull) throw ApiProblem.bad("INVALID_GROUP_PATH");
        text(key,dim.length);
        if(dim==Dimension.RISK) enumeration(key,Set.of("HIGH","MEDIUM","LOW"));
        if(dim==Dimension.BORROWER) enumeration(key,Set.of("INDIVIDUAL","CORPORATE"));
    }
    private static boolean flag(String value) {
        if(value==null || value.equals("false")) return false;
        if(value.equals("true")) return true;
        throw ApiProblem.bad("INVALID_GROUP_PATH");
    }
    private static void text(String value,int maximum) {
        if(value!=null && (value.length()>maximum || value.chars().anyMatch(c->Character.isISOControl(c)))) throw ApiProblem.bad("INVALID_FILTER");
    }
    private static void enumeration(String value,Set<String> allowed) {
        if(value!=null && !allowed.contains(value)) throw ApiProblem.bad("INVALID_FILTER");
    }
    private static LocalDate date(String value) {
        if(value==null) return null;
        try {
            if(!value.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) throw new IllegalArgumentException();
            LocalDate result=LocalDate.parse(value);
            if(result.getYear()<1) throw new IllegalArgumentException();
            return result;
        } catch(RuntimeException ex) { throw ApiProblem.bad("INVALID_DATE_RANGE"); }
    }
}
