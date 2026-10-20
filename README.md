# 🏴‍☠️ PIRATAS

Juego de estrategia y aventura naval para **2 a 4 jugadores** (amigos y bots), basado en el **Reglamento V1.39**

Cada jugador lleva un barco pirata por un archipiélago de 12 × 12 casillas con niebla de guerra: explora islas, comercia entre puertos, mejora su barco y combate contra mercantes, otros piratas y la Armada. Gana quien llegue a 12 Puntos de Leyenda, o quien tenga más tras la ronda 15.

## Jugar en local

Requisitos: [Node.js](https://nodejs.org) 18 o superior.

```bash
npm install
npm start
```

Abre <http://localhost:3000>, escribe tu nombre y pulsa **Crear partida**. Comparte el enlace o el código de 4 letras con tus amigos, o añade bots.

## Publicarlo en internet (gratis) con Render.com

El repositorio incluye `render.yaml`:

1. Entra en <https://render.com> con tu cuenta de **GitHub**.
2. **New +** → **Blueprint** → elige el repositorio **piratas** → **Connect**.
3. Render muestra el servicio `piratas` (plan Free). Pulsa **Apply** / **Deploy Blueprint**.
4. Cuando ponga **Live**, comparte la dirección (`https://piratas-xxxx.onrender.com`) con tus amigos.

Cada cambio en la rama `main` se publica solo. En el plan gratuito el servidor se duerme tras unos 15 minutos sin uso y tarda 30–60 s en despertar; las partidas se guardan en memoria y se pierden si el servidor se reinicia.

## Cómo se juega en la web

- **Sala:** el anfitrión crea la partida, comparte el enlace o el código y puede **añadir bots**. Se empieza con **¡Zarpar!**.
- **Tu turno (90 s, 3 acciones):**
  - **Navegar:** pulsa el botón y después las casillas marcadas. Como solo se ve el 3 × 3, normalmente se avanza casilla a casilla.
  - **Explorar** y **Atracar:** desde el panel o pulsando la isla o el puerto.
  - **Atacar o comerciar:** desde «A la vista».
  - **Puerto:** comerciar, mejorar, reparar y reclutar.
- **Combate:** una ventana con los dos barcos. Cada capitán elige Cañonear, Abordar o Maniobrar (20 s; si no eliges, tu barco cañonea). Se ven los dados de cada asalto.
- **Precios:** el botón de arriba muestra los precios de todos los puertos descubiertos, para planear rutas comerciales.

## Estructura

| Archivo | Contenido |
| --- | --- |
| `src/config.js` | **Todas las tablas del reglamento** (mejoras, precios, exploración, combate, mercantes, Armada, PL, tiempos). Para equilibrar, se cambia aquí. |
| `src/map.js` | Generación del archipiélago, movimiento en 8 direcciones (esquinas, arrecifes), distancias y línea de tiro. |
| `src/game.js` | Motor: turnos, acciones, comercio, combate, hundimientos, fase neutral, plazos y lo que ve cada jugador. |
| `src/ai.js` | Maniobras de mercantes, fragatas y bots en combate. |
| `src/bot.js` | Jugador automático (solo usa lo que ha descubierto). |
| `src/server.js` | Servidor web y salas en tiempo real (Socket.IO). |
| `public/` | Interfaz web; `public/img/` ilustraciones y `public/sonidos/` sonidos. |
| `test/rules.test.js` | Tests de reglas y partidas completas con bots: `npm test`. |

## Ilustraciones de los barcos

Se buscan en `public/img/` en `.webp` o `.png`. Si falta alguna, se usa un dibujo provisional:

| Archivo | Barco |
| --- | --- |
| `barco-1` | Barco pirata inicial (un mástil). Suma de niveles de las 5 mejoras: 5–7. |
| `barco-2` | Barco pirata mejorado (tres mástiles). Suma 8–11. |
| `barco-3` | Barco pirata de leyenda (el más grande). Suma 12–15. |
| `mercante` | Opcional. Si no existe, el mercante usa `barco-1` aclarado y con franja verde. |
| `fragata` | Opcional. Si no existe, la fragata usa `barco-3` en tono acero y con franja azul marino. |

Mejor con fondo transparente. El color de cada jugador se muestra con una franja bajo su barco.

Texturas del tablero (en `public/img/`):

| Archivo | Uso |
| --- | --- |
| `mar.webp` | Mar, continuo de casilla en casilla (los arrecifes llevan rocas encima). |
| `tierra.webp` | Tierra de las islas de varias casillas. |
| `colina.webp` | La casilla más interior de cada isla sin puerto de 3 o más casillas. |
| `isla.webp` | Islotes de una sola casilla. |
| `puerto-1/2/3.webp` | Puertos (se reparten entre los 9). Se giran para que el muelle mire al lado con más mar. |
| `niebla.webp` | Niebla de guerra sobre lo que aún no se ha descubierto. |
| `mesa.webp` | Fondo de la página (mesa de capitán). |
| `pergamino.webp` | Fondo de los paneles, la portada y las ventanas. |
| `oro.webp`, `carga.webp`, `tripulacion.webp` | Iconos de oro, bodega y tripulación. |
| `comida.webp`, `materiales.webp`, `manufacturas.webp`, `lujos.webp` | Iconos de las mercancías. |
| `casco.webp`, `tesoro.webp`, `sables.webp` | Casco, Puntos de Leyenda y aviso de tesoro, y la maniobra de Abordar. |
| `velas.webp`, `canon.webp`, `yunque.webp`, `martillo.webp` | Velas y Navegar; Cañones y Cañonear; Mejorar; Reparar. |
| `arrecife.webp` | Arrecifes. |
| `costa.webp` | Borde de playa en cada lado (y esquina) de una casilla de mar que toca tierra: la lámina se gira hacia la tierra y solo se usa su franja de playa. |
| `oceano.webp` | Mar profundo: casillas de mar rodeadas de mar por los 8 lados; se funde con el mar normal. |
| `poblado.webp` | La casilla de tierra más cercana al puerto en las islas con puerto. |

## Decisiones tomadas donde el reglamento no lo especifica

1. **Precios:** cada puerto paga por cada mercancía su valor base −1…+2 y la vende 1 oro más cara. Son fijos toda la partida. Los precios de un puerto se conocen en cuanto se descubre su casilla.
2. **Carga de un barco hundido:** si lo hunde otro pirata, este se lleva la mitad perdida, si le cabe en la bodega (a coste 0). Si lo hunde la Armada, un mercante o un peligro, se pierde.
3. **Atracado:** el barco está en la casilla del puerto. Al salir, la primera casilla de mar cuesta movimiento normal. Se puede atracar a mitad de un movimiento y seguir usando las acciones que queden. La restricción de regreso impide atracar en el último puerto visitado.
4. **Visión:** el terreno se descubre en 3 × 3, pero los **barcos se ven hasta 2 casillas** (el alcance de los cañones); si no, nunca se podría cañonear a distancia 2. Las fragatas detectan piratas a esa misma distancia.
5. **Iniciar un combate:** la acción elegida (Cañonear o Abordar) es la maniobra del atacante en el primer asalto. Si el combate empieza a distancia 2, nadie puede abordar en ese combate.
6. **Abordajes:** quien gana el abordaje captura hasta 2 mercancías (las más valiosas, a coste 0), el perdedor pierde un marinero y el combate termina. Si quien aborda es rechazado (cañoneo contra abordaje), pierde un marinero y el combate sigue. El empate favorece al defensor original del combate.
7. **Ventaja táctica:** también se gasta si abordas contra un barco que maniobra.
8. **Mercantes y Armada** nunca abordan. Los mercantes no atacan; las fragatas siempre empiezan cañoneando. Hundir un mercante no da su carga.
9. **Comercio con mercantes:** se puede comprar su carga y venderle (hasta 6 mercancías de bodega) a los precios de su puerto de destino. Las ventas cuentan para el beneficio neto.
10. **Venta:** las unidades se venden empezando por las más antiguas (su coste de compra cuenta para el beneficio). En una visita no se puede revender en el mismo puerto una mercancía comprada allí.
11. **Plazos:** 90 s por turno (se pausa durante combates y propuestas). 20 s para elegir maniobra o responder a un trato; si no, se cañonea o se rechaza.
12. **Islas con puerto** también se pueden explorar (desde el mar). Las mercancías encontradas que no caben se pierden.
13. **Bots en el comercio:** aceptan un trato si reciben al menos el valor base de lo que dan.

## Equilibrio medido con bots

Con 60 partidas simuladas de bots:

- Las partidas duran unas **10 rondas**; el 80 % termina por alcanzar 12 PL.
- Hay 0,5 hundimientos por jugador y 3 mejoras por jugador de media.
- Los PL salen sobre todo de **tesoros (40 %)** y **comercio (37 %)**. Después vienen fragatas (10 %), mercantes (4 %) y piratas (2 %).
- Los bots juegan de forma sencilla: las cifras sirven para comparar cambios, no para predecir partidas entre personas.
