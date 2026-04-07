SELECT [Issued Reminder Header].No_, [Issued Reminder Header].[Customer No_], [Issued Reminder Header].Name
FROM [Issued Reminder Line] INNER JOIN [Issued Reminder Header] ON [Issued Reminder Line].[Reminder No_] = [Issued Reminder Header].No_
WHERE ((([Issued Reminder Line].Type)=13))
GROUP BY [Issued Reminder Header].No_, [Issued Reminder Header].[Customer No_], [Issued Reminder Header].Name;

