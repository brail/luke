SELECT SoggettiProvvigionaliSistemazione2018.*, [ProspettoProvvigioniStagioneMarchio-Sistemazione2018].*
FROM [ProspettoProvvigioniStagioneMarchio-Sistemazione2018] INNER JOIN SoggettiProvvigionaliSistemazione2018 ON (SoggettiProvvigionaliSistemazione2018.No_ = [ProspettoProvvigioniStagioneMarchio-Sistemazione2018].[Document No_]) AND ([ProspettoProvvigioniStagioneMarchio-Sistemazione2018].[Salesperson Code] = SoggettiProvvigionaliSistemazione2018.[Salesperson Code]);

