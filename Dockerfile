# Usa la imagen oficial con Node 20 LTS
FROM node:20 as bot
# Establece el directorio de trabajo en el contenedor
WORKDIR /app

# Copia los archivos de tu proyecto al contenedor
COPY package*.json ./

# Instala las dependencias del proyecto
RUN npm install

# Copia el resto de los archivos del proyecto al contenedor
COPY . .



# Comando para iniciar tu aplicación Node.js
CMD ["npm", "start"]
