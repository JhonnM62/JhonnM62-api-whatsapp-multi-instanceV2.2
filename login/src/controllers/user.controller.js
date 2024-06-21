import User from "../models/User.js";
import jwt from "jsonwebtoken";
import { SECRET } from "../config.js";

export const createUser = async (req, res) => {
    try {
        const { nombrebot, email, password, duracionMembresiaDias } = req.body;

        // Calcular fechas de inicio y fin de la membresía
        const fechaInicio = new Date();
        const fechaFin = new Date();
        fechaFin.setDate(fechaInicio.getDate() + duracionMembresiaDias);

        // Crear un nuevo objeto de usuario
        const user = new User({
            nombrebot,
            email,
            password,
            duracionMembresiaDias,
            fechaInicio,
            fechaFin,
        });

        // Encriptar la contraseña
        user.password = await User.encryptPassword(user.password);

        // Guardar el nuevo usuario
        const savedUser = await user.save();

        // Crear un token con la duración de la membresía en días
        const token = jwt.sign({ id: savedUser._id }, SECRET, {
            expiresIn: duracionMembresiaDias * 24 * 60 * 60, // Duración en segundos
        });

        // Asignar el token al usuario y guardar nuevamente en la base de datos
        savedUser.token = token;
        await savedUser.save();

        return res.status(200).json({
            _id: savedUser._id,
            nombrebot: savedUser.nombrebot,
            email: savedUser.email,
            token: savedUser.token,
            duracionMembresiaDias: savedUser.duracionMembresiaDias,
            fechaInicio: savedUser.fechaInicio,
            fechaFin: savedUser.fechaFin,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
};

export const getUsers = async (req, res) => {
    try {
        const users = await User.find();
        return res.json(users);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
};

export const getUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        return res.json(user);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
};
