SELECT FattureTemporaneeEDdtStep0.No_, Count(FattureTemporaneeEDdtStep0.[DDT No_]) AS [DDT No_], Min(FattureTemporaneeEDdtStep0.[Posted No_]) AS [MinDiPosted No_]
FROM FattureTemporaneeEDdtStep0
GROUP BY FattureTemporaneeEDdtStep0.No_
ORDER BY Count(FattureTemporaneeEDdtStep0.[DDT No_]), Min(FattureTemporaneeEDdtStep0.[Posted No_]);

