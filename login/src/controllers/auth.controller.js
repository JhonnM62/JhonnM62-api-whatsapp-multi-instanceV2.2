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
    if (user.username) {
      return res.status(400).json({
        message:
          "Ya tiene un nombre de usuario asignado y no puede actualizarlo.",
      });
    }

    // Actualiza el nombre de usuario y establece 'hasUsernameChanged' en true
    user.username = id;
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
    if (!user.username) {
      return res.status(400).json({
        message: "No se encontró un nombre de usuario para eliminar.",
      });
    }

    // Elimina el nombre de usuario (estableciéndolo como nulo o una cadena vacía)
    user.username = null; // o user.username = "";
    user.hasUsernameChanged = true;
    await user.save();
    return res.status(200).json({ message: "Se acutlizo con exito" });
  } catch (error) {
    return res.status(500).json(error.message);
  }
};

export const signupHandler = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Crear un nuevo objeto de usuario
    const newUser = new User({
      username,
      email,
      password,
    });

    // Guardar el objeto de usuario en MongoDB
    const savedUser = await newUser.save();

    // Crear un token
    const token = jwt.sign({ id: savedUser._id }, SECRET, {
      expiresIn: 2592000, // 30 días
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
      $or: [{ email }, { username: email }],
    });

    if (!userFound)
      return res.status(400).json({ message: "Usuario no encontrado" });

    const matchPassword = await User.comparePassword(
      password,
      userFound.password
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
