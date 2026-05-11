SELECT [Reserv__Assign_ Link].[Sales Document No_], [Reserv__Assign_ Link].[Sales Line No_], [Reserv__Assign_ Link].[Reserv__Assign_ Type], Max([Reserv__Assign_ Link].[Date Reservation]) AS [Date Reservation]
FROM [Reserv__Assign_ Link]
GROUP BY [Reserv__Assign_ Link].[Sales Document No_], [Reserv__Assign_ Link].[Sales Line No_], [Reserv__Assign_ Link].[Reserv__Assign_ Type]
HAVING ((([Reserv__Assign_ Link].[Reserv__Assign_ Type])=1));

