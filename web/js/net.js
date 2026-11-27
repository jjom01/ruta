// Dirección del servidor de Ruta (buses en vivo, alertas, trazados y búsqueda de lugares).
// Por defecto es el mismo sitio que sirve la app. En la app instalada del teléfono (que lleva la web adentro) o con un servidor
// aparte se define con <meta name="ruta-api" content="https://…"> o con window.RUTA_API antes de cargar los módulos.
const base = () => (window.RUTA_API || document.querySelector('meta[name="ruta-api"]')?.content || "").replace(/\/+$/, "");
export const apiUrl = (path) => base() + path;
