# DekaLab — Comparador de carreras DEKA

DekaLab es una aplicación web para guardar, organizar y comparar resultados de DEKA FIT, DEKA MILE y DEKA STRONG. Importa resultados públicos de Race Result, analiza los parciales y consulta tu evolución en el tiempo.

## Requisitos

- Node.js `22.13` o posterior.
- npm.

## Ejecutar en local

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

Para probarla desde otro dispositivo de la misma red:

```bash
npm run dev -- --hostname 0.0.0.0
```

En ese caso, añade la IP local del ordenador en `allowedDevOrigins` dentro de `next.config.js`.

## Funciones principales

- Importar una carrera desde un enlace público de Race Result.
- Revisar y guardar nombre, fecha, modalidad, participante, tiempo, parciales y penalizaciones.
- Añadir y editar notas personales.
- Marcar una carrera como mejor marca personal (PB).
- Usar la PB para identificar el participante y filtrar la gráfica de evolución.
- Comparar dos o más carreras seleccionadas.
- Ver diferencias de tiempo y el parcial más rápido.
- Consultar un gráfico de evolución del tiempo total.
- Filtrar por modalidad y ordenar por fecha, tiempo o nombre.
- Cambiar entre vista de cuadrícula y vista de lista.
- Descargar una copia JSON e importarla posteriormente.
- Eliminar carreras con confirmación.

## Datos y privacidad

Los datos se guardan en el `localStorage` del navegador y no requieren una cuenta. Esto significa que cada navegador y dispositivo tiene su propia colección de carreras. Usa **Guardar carreras** para descargar una copia de seguridad.

## Producción

Compilar y ejecutar localmente la versión de producción:

```bash
npm run build
npm start
```

El proyecto puede desplegarse en Vercel como aplicación Next.js. Si el repositorio está conectado a Vercel, cada push a la rama `main` genera un nuevo despliegue.

## Estructura básica

- `app/page.tsx`: interfaz, estado y lógica del comparador.
- `app/global.css`: estilos y diseño responsive.
- `app/api/import-race/route.ts`: importación y lectura de resultados Race Result.
- `next.config.js`: configuración de Next.js para desarrollo en red local.
