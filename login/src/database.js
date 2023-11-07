import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config(); // Carga la configuración del archivo .env
mongoose.set("strictQuery", false);
const uri = process.env.DB_HOST;
main().catch((err) => console.log(err));

async function main() {
  try {
    await mongoose.connect(uri);

    console.log("¡Conexión exitosa a MongoDB!");
  } catch (error) {
    console.error("Error al conectar a MongoDB:", error.message);
  }
}
