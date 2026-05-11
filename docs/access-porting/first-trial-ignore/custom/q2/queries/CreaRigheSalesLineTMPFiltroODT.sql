INSERT INTO SalesLineTMP ( [Document NO_], [Line NO_], [Customer NO_], NO_, qty )
SELECT [Transfer Line].[Document No_], [Transfer Line].[Line No_], [Transfer Header].[Transfer-to Code], [Transfer Line].[Item No_], Val([quantity]) AS Espr1
FROM [Transfer Header] INNER JOIN [Transfer Line] ON [Transfer Header].No_ = [Transfer Line].[Document No_]
WHERE ((([Transfer Line].[Document No_])=[Forms]![Principale]![FiltroODTEan]));

