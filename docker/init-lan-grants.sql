-- Acceso desde otras PCs de la misma LAN al contenedor MariaDB.
-- phpMyAdmin y el healthcheck siguen usando la red interna de Docker.
CREATE USER IF NOT EXISTS 'root'@'%' IDENTIFIED BY 'root';
GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
