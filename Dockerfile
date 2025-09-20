# Usamos la imagen de Node.js 20 con Alpine para que sea ligera
FROM node:20-alpine

# Establecemos el directorio de trabajo dentro del contenedor
WORKDIR /app

# Copiamos los archivos de manifiesto para instalar las dependencias
COPY package.json ./

# Instalamos únicamente las dependencias de producción
RUN npm install

# Copiamos todo el código fuente de la aplicación
COPY . .

# Exponemos el puerto interno de la aplicación (8001)
EXPOSE 8001

# Comando para iniciar la aplicación. Docker ejecutará "npm start".
CMD [ "npm", "start" ]