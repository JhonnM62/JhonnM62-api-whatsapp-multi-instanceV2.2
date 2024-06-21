import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { SECRET } from "../config.js";

export const updateUsernameHandler = async (req, res, next) => {
    try {
        const { id, token } = req.body;

        // Descifra el token para obtener el ID del usuario
        const decodedToken = jwt.verify(token, SECRET);
        const userId = decodedToken.id;

        // Verifica si el usuario ya tiene un nombre de usuario
        const user = await User.findById(userId);
        if (user.nombrebot) {
            return res.status(400).json({
                message:
                    "Ya tiene un nombre de usuario asignado y no puede actualizarlo.",
            });
        }

        // Actualiza el nombre de usuario y establece 'hasUsernameChanged' en true
        user.nombrebot = id;
        user.hasUsernameChanged = true;
        await user.save();
        next();
    } catch (error) {
        return res.status(500).json(error.message);
    }
};

export const deleteUsernameHandler = async (req, res, next) => {
    try {
        const { token } = req.body;

        // Descifra el token para obtener el ID del usuario
        const decodedToken = jwt.verify(token, SECRET);
        const userId = decodedToken.id;

        // Verifica si el usuario ya tiene un nombre de usuario
        const user = await User.findById(userId);
        if (!user.nombrebot) {
            return res.status(400).json({
                message: "No se encontró un nombre de usuario para eliminar.",
            });
        }

        // Elimina el nombre de usuario (estableciéndolo como nulo o una cadena vacía)
        user.nombrebot = null; // o user.nombrebot = "";
        user.hasUsernameChanged = true;
        await user.save();
        return res.status(200).json({ message: "Se acutlizo con exito" });
    } catch (error) {
        return res.status(500).json(error.message);
    }
};

export const signupHandler = async (req, res) => {
    try {
        const { nombrebot, email, password, duracionMembresiaDias } = req.body;

        // Calcular fechas de inicio y fin de la membresía
        const fechaInicio = new Date();
        const fechaFin = addDays(fechaInicio, duracionMembresiaDias);

        // Crear un nuevo objeto de usuario
        const newUser = new User({
            nombrebot,
            email,
            password,
            duracionMembresiaDias,
            fechaInicio,
            fechaFin,
        });

        // Guardar el objeto de usuario en MongoDB
        const savedUser = await newUser.save();

        // Crear un token con la duración de la membresía en días
        const token = jwt.sign({ id: savedUser._id }, SECRET, {
            expiresIn: duracionMembresiaDias * 24 * 60 * 60, // Duración en segundos
        });

        // Asignar el token al usuario y guardar nuevamente en la base de datos
        savedUser.token = token;
        await savedUser.save();

        return res.status(200).json({ token });
    } catch (error) {
        return res.status(500).json(error.message);
    }
};

export const signinHandler = async (req, res) => {
    try {
        // El cuerpo de la solicitud puede contener un correo electrónico o un nombre de usuario
        const { email, password } = req.body;

        // Buscar al usuario por correo electrónico o nombre de usuario
        const userFound = await User.findOne({
            $or: [{ email }, { nombrebot: email }],
        });

        if (!userFound)
            return res.status(400).json({ message: "Usuario no encontrado" });

        const matchPassword = await User.comparePassword(
            password,
            userFound.password,
        );

        if (!matchPassword)
            return res.status(401).json({
                token: null,
                message: "Contraseña no válida",
            });

        // Devolver el token almacenado en la base de datos
        res.json({ token: userFound.token });
    } catch (error) {
        console.log(error);
    }
};

// Función para agregar días a una fecha
const addDays = (date, days) => {
    if (isNaN(days) || !(date instanceof Date) || isNaN(date.getTime())) {
        throw new Error("Invalid input for addDays function");
    }
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    console.log(
        `addDays - Fecha Inicio: ${date.toISOString()}, Fecha Fin: ${result.toISOString()}`,
    );
    return result;
};

export const renewMembership = async (req, res) => {
    try {
        const { token, duracionRenovacionDias } = req.body;

        // Verificar que duracionRenovacionDias sea un número
        const duracionDias = parseInt(duracionRenovacionDias, 10);
        if (isNaN(duracionDias) || duracionDias <= 0) {
            return res
                .status(400)
                .json({ message: "Invalid duration provided" });
        }

        // Decodificar el token sin verificar su expiración
        let decoded;
        try {
            decoded = jwt.decode(token);
        } catch (error) {
            return res.status(401).json({ message: "Invalid token" });
        }

        if (!decoded || !decoded.id) {
            return res.status(401).json({ message: "Invalid token" });
        }

        // Buscar el usuario en la base de datos por el ID del token
        const user = await User.findById(decoded.id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Convertir fechaFin de string a objeto Date si no lo es
        console.log(`renewMembership - fechaFin (original): ${user.fechaFin}`);
        let fechaFin = new Date(user.fechaFin);
        if (isNaN(fechaFin.getTime())) {
            return res.status(400).json({ message: "Invalid fechaFin format" });
        }

        // Usar la fecha actual si la fecha de expiración actual es mayor que la fecha actual
        const fechaActual = new Date();
        if (fechaFin < fechaActual) {
            fechaFin = fechaActual;
        }

        console.log(
            `renewMembership - fechaFin (Date object): ${fechaFin.toISOString()}`,
        );

        // Calcular nueva fecha de finalización
        const nuevaFechaFin = addDays(fechaFin, duracionDias);
        console.log(
            `renewMembership - nuevaFechaFin: ${nuevaFechaFin.toISOString()}`,
        );

        // Actualizar la fecha de finalización en la base de datos del usuario
        user.fechaFin = nuevaFechaFin;
        await user.save();

        // Generar un nuevo token con la nueva duración desde la fecha de expiración actual
        const nuevoToken = jwt.sign({ id: user._id }, SECRET, {
            expiresIn: Math.floor(
                (nuevaFechaFin.getTime() - Date.now()) / 1000,
            ), // Duración en segundos
        });

        return res.status(200).json({
            token: nuevoToken,
            duracionMembresiaDias: duracionDias, // Ajustamos la respuesta
            fechaInicio: user.fechaInicio,
            fechaFin: user.fechaFin.toISOString(), // Convertir fechaFin a formato ISO 8601
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
};
