// Prueba local de la entrada serverless (api/index.js) en el puerto 3001.
import app from "../api/index.js";
app.listen(3001, () => console.log("cloud demo en 3001"));
