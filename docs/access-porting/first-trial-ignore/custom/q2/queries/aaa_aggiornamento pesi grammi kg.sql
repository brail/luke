UPDATE Item SET Item.[Net Weight] = Val([net weight])/"1000", Item.[Gross Weight] = Val([gross weight])/"1000"
WHERE (((Val([gross weight]))>50));

