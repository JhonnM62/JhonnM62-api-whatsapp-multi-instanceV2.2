FROM node:18-bullseye as bot
# Establece el directorio de trabajo en el contenedor
WORKDIR /app

# Copia los archivos de tu proyecto al contenedor
COPY package.json package-lock.json ./

# Instala las dependencias del proyecto
RUN npm install

# Copia el resto de los archivos del proyecto al contenedor
COPY . .



# Comando para iniciar tu aplicación Node.js
CMD ["node", "app.js"]
