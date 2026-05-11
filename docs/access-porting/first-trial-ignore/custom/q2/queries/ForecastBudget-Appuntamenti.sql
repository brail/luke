SELECT [To-do].[Budget No_], [To-do].[Source Type], [To-do].[Source No_], Max([To-do].Date) AS Appuntamento
FROM [To-do]
GROUP BY [To-do].[Budget No_], [To-do].[Source Type], [To-do].[Source No_];

