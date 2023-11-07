import { Router } from "express";
import multer from "multer";
import { convertAudio } from "../convertidor-audio.js";
import fs from "fs";

const router = Router();

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "public/uploads");
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + "-" + file.originalname);
    },
});
const upload = multer({ storage: storage });

router.get("/", (req, res) => {
    try {
        res.render("index", { imagePath: null }); // Inicializa imagePath como null
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({
            error: "Error al renderizar la página principal",
        });
    }
});

// Ruta para manejar la carga de imágenes
router.post("/upload", upload.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return res
                .status(400)
                .json({ error: "No se ha proporcionado ningún archivo" });
        }

        const imagePath = "./public/uploads/" + req.file.filename;
        console.log(imagePath);
        // Verifica si el archivo subido es un archivo de audio
        if (req.file.mimetype.startsWith("audio/")) {
            // Aquí deberías implementar la función convertAudio(url) que convierte el archivo de audio
            const convertedAudioPath = await convertAudio(imagePath);
            // Elimina el archivo original después de la conversión
            fs.unlink(imagePath, (err) => {
                if (err) {
                    console.error(
                        "Error al eliminar el archivo original:",
                        err,
                    );
                } else {
                    const rutaCorregida =
                        "./" + convertedAudioPath.replace(/\\/g, "/");
                    // Pasa la ruta del archivo de audio convertido a la vista
                    res.render("index", { imagePath: rutaCorregida });
                }
            });
        } else {
            res.render("index", { imagePath }); // Pasa imagePath a la vista
        }
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({
            error: "Error al cargar o convertir el archivo",
        });
    }
});

router.post(
    "/upload2",

    upload.single("file"),
    async (req, res) => {
        try {
            if (!req.file) {
                return res
                    .status(400)
                    .json({ error: "No se ha proporcionado ningún archivo" });
            }

            console.log(req.file);

            const imagePath = "./public/uploads/" + req.file.filename;

            // Verifica si el archivo subido es un archivo de audio
            if (
                req.file.mimetype.startsWith("audio/") ||
                /\.(mp3|wav|flac|ogg|m4a|opus)$/.test(req.file.originalname)
            ) {
                console.log("entre aqui 1");
                // Aquí deberías implementar la función convertAudio(url) que convierte el archivo de audio
                const convertedAudioPath = await convertAudio(imagePath);
                // Elimina el archivo original después de la conversión
                fs.unlink(imagePath, (err) => {
                    if (err) {
                        console.error(
                            "Error al eliminar el archivo original:",
                            err,
                        );
                    } else {
                        const rutaCorregida =
                            "./" + convertedAudioPath.replace(/\\/g, "/");
                        // Pasa la ruta del archivo de audio convertido a la vista
                        res.status(200).json({ imagePath: rutaCorregida });
                    }
                });
            } else {
                console.log("entre aqui 2");
                res.status(200).json({ imagePath });
            }
        } catch (error) {
            console.error("Error:", error);
            res.status(500).json({
                error: "Error al cargar o convertir el archivo",
            });
        }
    },
);

export default router;
