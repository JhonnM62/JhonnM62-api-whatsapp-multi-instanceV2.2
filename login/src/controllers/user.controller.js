import User from "../models/User.js";

export const createUser = async (req, res) => {
    try {
        const { nombrebot, email, password } = req.body;

        // creating a new User
        const user = new User({
            nombrebot,
            email,
            password,
        });

        // encrypting password
        user.password = await User.encryptPassword(user.password);

        // saving the new user
        const savedUser = await user.save();

        return res.status(200).json({
            _id: savedUser._id,
            nombrebot: savedUser.nombrebot,
            email: savedUser.email,
        });
    } catch (error) {
        console.error(error);
    }
};

export const getUsers = async (req, res) => {
    const users = await User.find();
    return res.json(users);
};

export const getUser = async (req, res) => {
    const user = await User.findById(req.params.userId);
    return res.json(user);
};
