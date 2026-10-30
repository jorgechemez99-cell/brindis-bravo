# Brindis Bravo · Chat en vivo

Chat en vivo para un show presencial. La gente escanea un QR, se hace una cuenta con apodo y clave, y comenta desde el celular: los mensajes salen en la pantalla del lugar, encima de lo que se esté proyectando. Los conductores leen el chat completo en su celu sin darse vuelta, y la producción modera, destaca y lanza encuestas desde el mismo chat o desde el panel.

Corre gratis en **Cloudflare**: no hace falta servidor propio, la dirección no cambia nunca y aguanta de sobra a 150 personas.

**Sitio de Brindis Bravo:** <https://brindis-bravo.brindis-bravo.workers.dev>

---

## Índice

- [Qué tiene](#qué-tiene)
- [Las cuatro partes](#las-cuatro-partes)
- [Quién ve qué](#quién-ve-qué)
- [Primera vez: la clave del admin y el equipo](#primera-vez-la-clave-del-admin-y-el-equipo)
- [El público](#el-público)
- [Moderar](#moderar)
- [Programas y título](#programas-y-título)
- [Armar la pantalla](#armar-la-pantalla)
- [La app de escritorio](#la-app-de-escritorio)
- [Encuestas](#encuestas)
- [Ensayo y noche del show](#ensayo-y-noche-del-show)
- [Si algo falla](#si-algo-falla)
- [Límites del plan gratis](#límites-del-plan-gratis)
- [Armar tu propia copia](#armar-tu-propia-copia)
- [Para programadores](#para-programadores)

---

## Qué tiene

- **Un solo QR para todos**: abre la puerta de entrada y a cada uno lo lleva a su lugar según su rol (público, conductor, productor o admin). Sin bajar nada.
- **Cuentas con apodo y clave**: cada apodo es de una sola persona y cada celular puede crear una sola cuenta, así nadie aparece con dos nombres.
- **Cada rol ve lo suyo**: el público no ve el chat; tiene su cajita para escribir, ve los destacados unos segundos y las encuestas (que le saltan solas). Conductores y productores ven el chat completo.
- **Íconos por rol** al lado del nombre: 🎙️ conducción, 🎬 producción, 👑 admin, y 📢 para los mensajes de la producción.
- **Pantalla transparente** encima de lo que se proyecta, con el chat, un mensaje destacado, la encuesta y el QR. Cada caja se puede mover, agrandar, ocultar y cambiar de opacidad.
- **App de escritorio** (Mac y Windows) que pone el chat encima de todo, con una botonera: **Editar** la pantalla ahí mismo con el mouse, **Usar la PC** normal viendo todo, y **Ocultar** todo de una.
- **Título** "Brindis Bravo · programa de ahora" y **contador de gente** conectada (los dos se pueden ocultar).
- **Moderación desde el chat**: los productores tienen una ✕ en cada mensaje (con *Deshacer*), además de destacar, **silenciar** (5, 15 o 60 minutos), **vetar**, mandar **📢 mensajes de la producción** y **armar encuestas**, todo desde el celu.
- **Panel de producción**: moderar, aprobar antes de mostrar, pausar, mensajes de la producción, encuestas, armado de la pantalla, QR para imprimir, equipo y programas.
- **Encuestas en vivo** con resultados animados en pantalla.
- **Mensajes fijos** (opcional): quedan en pantalla hasta que los empujen otros nuevos.
- **Blindado**: si se corta internet, todo se reconecta solo y lo que se escribió mientras tanto sale cuando vuelve. Nada se duplica.
- **Sin filtros de palabras**: sólo un máximo de 280 caracteres por mensaje.

## Las cuatro partes

| Dónde | Quién | Para qué |
|---|---|---|
| `/` (lo abre el QR) | Todos, desde el celular | La puerta de entrada: crear la cuenta o entrar, y cada uno va a su lugar (ver [Quién ve qué](#quién-ve-qué)) |
| `/panel` | Admin (y productores, si lo necesitan) | Todo el control del show: pantalla, equipo, programas, encuestas, QR |
| App **Brindis Bravo** | La compu que proyecta | Pone el chat encima de todo lo que haya en esa compu; se edita con el mouse |
| `/pantalla` | OBS o un navegador | La misma capa del chat, con fondo transparente, para usar sin la app |

## Quién ve qué

Todos entran por el mismo QR (o por la dirección del sitio). El público crea su cuenta con **¡Sumate al chat!**; el equipo entra con **¿Ya tenés cuenta? Entrá acá** y su usuario del panel. Según el rol, cada uno termina en un lugar distinto:

| Rol | A dónde va | Qué ve | Qué puede hacer |
|---|---|---|---|
| **Público** | Su cajita para escribir | No ve el chat. Ve si su mensaje salió, los destacados durante unos segundos ("⭐ ¡Destacaron tu mensaje!" si es el suyo) y las encuestas, que le saltan en el medio de la pantalla | Escribir y votar |
| 🎙️ **Conductor** | El chat completo | Todo lo que escribe el público, en vivo, para leerlo sin darse vuelta a mirar la pantalla | Escribir y **destacar** mensajes (tocando el mensaje) |
| 🎬 **Productor** | El chat completo, con herramientas | Todo | Lo del conductor, más ✕ borrar (con *Deshacer*), silenciar, vetar, **📢** mandar como producción, **📊 Encuestas** (armar, lanzar, cerrar). Tiene un link al **Panel** |
| 👑 **Admin** | El **panel** | Todo | Todo, incluido el equipo y los programas. Desde el panel, **💬 Chat** lo lleva al chat con las herramientas del productor |

Los roles los asigna el admin en el panel (pestaña **Equipo**). Lo que escribe el equipo sale en la pantalla con el ícono de su rol.

## Primera vez: la clave del admin y el equipo

Todo se hace desde el navegador, sin terminal.

1. Abrí `/panel` (por ejemplo <https://brindis-bravo.brindis-bravo.workers.dev/panel>). La primera vez aparece **¡Primera vez!**: el usuario es `admin`; elegís la clave, la repetís y tocás **Guardar y entrar**. Esta pantalla aparece una sola vez. También se crean **Programa 1, 2 y 3**, que después se renombran o borran.
2. Pestaña **Equipo → Agregar a alguien del equipo**: usuario, clave y rol. Al tocar **Agregar** aparece un cuadrito con el link, el usuario y la clave para **Copiar** o **Compartir…** por WhatsApp.
3. Cada uno cambia su clave con **Mi clave** (arriba a la derecha). Si una clave es fácil de adivinar, el panel lo avisa en amarillo hasta que se cambie.

**Roles del equipo**: 🎬 **Productor**, 🎙️ **Conductor** y 👑 **Admin** (ver [Quién ve qué](#quién-ve-qué)). El rol de cada uno se cambia ahí mismo, en **Quiénes entran al panel**, y se guarda solo.

## El público

- Escanea el QR → **¡Sumate al chat!** → apodo y clave → **Entrar al chat**.
- Si cierra la página o vuelve otro día, sigue adentro (la sesión dura 30 días). Desde otro celular entra con **¿Ya tenés cuenta? Entrá acá**.
- Escribe (hasta 280 caracteres, con una espera mínima entre mensajes que se ajusta en el panel) y lo que manda sale en la pantalla. Abajo le aparece "✓ Tu mensaje salió en la pantalla" (o por qué no salió, o que lo están revisando).
- **No ve el chat**: ni lo que escribe el resto del público, ni lo del equipo o la producción. Eso está en la pantalla del lugar.
- Cuando se **destaca** un mensaje, le aparece una tarjeta durante 15 segundos. Si es el suyo: "⭐ ¡Destacaron tu mensaje en la pantalla!".
- Cuando se lanza una **encuesta**, le salta en el medio de la pantalla. Al votar se cierra sola y arriba quedan los resultados en vivo.
- El chat completo lo ven los conductores y la producción, y la pantalla del lugar.

## Moderar

**Desde el chat del celu** (entrando con un usuario de productor; los conductores sólo destacan):

- La **✕** de cada mensaje lo borra al instante, de la pantalla y de todos los celus. Abajo aparece **Deshacer** unos segundos, por si fue sin querer.
- **Tocando un mensaje**: Destacar en la pantalla (o quitar el destacado), Borrar, Silenciar 5 min / 15 min / 1 hora, Vetar.
- **📢** al lado de donde se escribe: prendido, lo que se manda sale como **mensaje de la producción**, resaltado en amarillo en la pantalla y en el chat del equipo.
- **📊 Encuestas**: armar una (pregunta y opciones) y **Lanzar ahora** o **Guardar para después**; lanzar las preparadas; **Cerrar la votación** y **Sacarla de la pantalla**.

**Desde el panel**, pestaña **Chat**: los mismos botones en cada mensaje, más:

- **Pausar chat**: nadie del público puede escribir.
- **Aprobar antes de mostrar**: nada sale sin un OK (el que escribe ve su mensaje "en revisión").
- **Limpiar pantalla**: vacía los mensajes de la pantalla (en los celus quedan).
- **Mensaje de la producción**: sale resaltado en amarillo.
- **Silenciados y vetados → Perdonar** deshace cualquier sanción.

**Silenciar**: la persona no puede escribir por ese rato y ve una cuenta regresiva.
**Vetar**: para siempre, y la persona no se entera. Lo que mandó desaparece de la pantalla y de los otros celus, y lo que mande después lo ve sólo ella.

## Programas y título

- El chat siempre está abierto y es uno solo, de corrido.
- Arriba en el panel se elige **el programa de ahora**. Eso sólo cambia el título ("Brindis Bravo · nombre del programa"; con *Sin programa* dice "Brindis Bravo"). No borra mensajes, ni el destacado, ni la encuesta.
- Cada mensaje queda anotado con el programa en que se mandó. **Descargar todo (CSV)** baja el chat entero con esa columna (se abre con Excel).
- Borrar un programa borra sus encuestas, pero no sus mensajes.

## Armar la pantalla

Se puede hacer **directo sobre la pantalla real** con la app (**✏️ Editar**, ver abajo) o desde el panel, pestaña **Pantalla**:

- **En pantalla**: mostrar u ocultar el chat, la encuesta, el destacado, el QR, el título y el **contador de gente**.
- **Los mensajes quedan hasta que los empujen otros nuevos**: prendido, los mensajes no se van por tiempo; sólo salen cuando llegan otros y no entran (la cantidad la marca *Mensajes a la vez*). Apagado, cada mensaje dura lo que diga *Cada mensaje queda* (45 s).
- **Vista previa**: arrastrá cada recuadro para moverlo y tirá de bordes o esquinas para agrandarlo. En la encuesta y el destacado la letra se acomoda sola; el QR siempre queda cuadrado.
- **Controles**: opacidad, fondos, letra, mensajes a la vez, duración de mensajes y del destacado, tamaño del QR, espera entre mensajes de una misma persona.
- **Dirección que abre el QR**: si se deja vacía, el QR lleva a este mismo sitio. El QR para imprimir está en la pestaña **QR**.

Todo se aplica en vivo.

## La app de escritorio

**Descarga**: en la página del repositorio, sección **Releases**, están los .zip para **Mac (Apple Silicon)**, **Mac (Intel)** y **Windows**. Vienen apuntando al sitio de Brindis Bravo (para usar otro sitio, ver [Armar tu propia copia](#armar-tu-propia-copia)).

**Mac**: descomprimir y arrastrar *Brindis Bravo* a Aplicaciones. La primera vez macOS avisa que es de un desarrollador no identificado: clic derecho sobre la app → **Abrir** → **Abrir**. Si dice que "está dañada", abrir la Terminal y pegar:

```bash
xattr -cr "/Applications/Brindis Bravo.app"
```

**Windows**: descomprimir la carpeta y abrir `Brindis Bravo.exe`. Si aparece "Windows protegió su PC": **Más información → Ejecutar de todas formas**.

**La botonera** (abajo a la derecha; se ve tenue y se ilumina al pasarle el mouse; se mueve arrastrando los puntitos):

- **✏️ Editar ↔ 🖱 Usar la PC**:
  - En *Editar* aparecen recuadros sobre el chat, la encuesta, el destacado y el QR. Se arrastran para moverlos y se tira de los bordes para agrandarlos.
  - Arriba hay una barra con interruptores (título, contador, mensajes fijos), opacidad, letra, fondo y *Simular mensajes*.
  - La primera vez pide el usuario y la clave del panel.
  - *Usar la PC* (o la tecla Esc) deja todo a la vista y la compu se maneja normal: los clics pasan de largo.
- **🙈 Ocultar ↔ 👁 Mostrar**: saca todo el chat de la vista de una.

**El globito** en la barra de menú (Mac) o en la bandeja (Windows), al lado del reloj. El puntito de la botonera muestra lo mismo:

- Colores: verde es conectado, amarillo es conectando y rojo es sin conexión (reintenta sola).
- Menú: editar, ocultar/mostrar todo, ocultar/mostrar la botonera, elegir pantalla (si hay más de una), recargar, abrir el panel, **cambiar el servidor**, salir.
- Atajos (en Mac, Cmd+Option+Shift en vez de Ctrl+Alt+Shift):
  - **Ctrl+Alt+Shift+E**: editar / usar la PC.
  - **Ctrl+Alt+Shift+C**: ocultar / mostrar todo.

**A tener en cuenta**

- La app carga la pantalla del sitio, así que las mejoras que se publiquen llegan solas, sin reinstalar. Si arranca sin internet, reintenta sola.
- Mientras está abierta, la pantalla de la compu no se apaga.
- **Mac**: el chat queda fijo aunque se haga clic en el fondo de pantalla para mostrar el escritorio, o se abra Mission Control. Si en alguna Mac igual se corriera: **Configuración del Sistema → Escritorio y Dock → "Hacer clic en el fondo de pantalla para mostrar el escritorio" → "Solo en Stage Manager"**.
- **Windows**: si la capa sale negra en vez de transparente, cerrar la app, crear el archivo `%APPDATA%\Brindis Bravo\config.json` con `{"sinAceleracion": true}` y volver a abrirla.
- **Con OBS**, en vez de la app: *Fuente de navegador* con la dirección `/pantalla` del sitio, de 1920×1080. El fondo ya es transparente.

## Encuestas

Desde el chat del productor (**📊 Encuestas**) o desde la pestaña **Encuestas** del panel:

1. Se preparan antes (pregunta y de 2 a 6 opciones) y quedan como *preparada*.
2. **Lanzar**: aparece en la pantalla y le salta en el celu a todo el público; se vota en vivo y cada uno puede cambiar su voto.
3. **Cerrar votación**: quedan los resultados en pantalla.
4. **Ocultar** cuando ya no hace falta.

Se pueden reabrir y mostrar resultados de encuestas viejas.

## Ensayo y noche del show

**Ensayo (con 6 celulares alcanza)**

1. Abrir la app en la compu que proyecta, conectada al proyector.
2. Elegir el programa de ahora en el panel.
3. Que cada uno escanee el QR, se haga la cuenta y mande mensajes. Un conductor y un productor entran con su usuario.
4. Probar: borrar con la ✕ y deshacer, destacar (también desde el conductor), 📢 mensaje de la producción, silenciar, vetar (y perdonar), pausar, limpiar y una encuesta de punta a punta desde **📊 Encuestas**.
5. Acomodar todo mirando el proyector real con **✏️ Editar**.
6. Imprimir el QR desde la pestaña **QR**.

**La noche del show**

- [ ] Compu de proyección con internet (y un celular con datos compartidos de respaldo).
- [ ] App abierta: globito **verde**, botonera en **🖱 Usar la PC**. En el panel dice **🖥 1 pantalla**.
- [ ] El **programa de ahora** elegido (sale en el título).
- [ ] Encuestas preparadas.
- [ ] QR impreso en las mesas y/o visible en pantalla.
- [ ] Los conductores con el chat abierto en el celu, y un productor con el chat (o el panel).
- [ ] Nadie publica cambios del código durante el show (reinicia la sala y todos se reconectan).

## Si algo falla

- **Un celu dice "Reconectando…"**: se reconecta solo. Lo que mande mientras tanto sale cuando vuelve.
- **La pantalla perdió la conexión**: globito rojo y un puntito rojo chiquito arriba a la derecha. Se reconecta sola; si tarda, revisar el internet de esa compu o pasar a los datos del celu.
- **Alguien molesta**: ✕ para borrar, *Silenciar* un rato o *Vetar*.
- **Hay que cortar ya**: **🙈 Ocultar** en la botonera saca todo de la vista; *Pausar chat* deja de recibir; *Aprobar antes de mostrar* hace que nada salga sin un OK.
- **Se colgó la app**: menú del globito → *Recargar*, o cerrarla y abrirla.
- **Alguien se olvidó la clave del chat**: en su celular la sesión dura 30 días, así que casi nunca hace falta. Desde otro celular puede crearse una cuenta nueva.

## Límites del plan gratis

No es ilimitado: es gratis **hasta cierto uso por día**. Los contadores vuelven a cero todos los días a las **21:00 de Argentina** (00:00 UTC).

| Qué | Límite diario gratis | Una noche con 150 personas (estimado generoso) |
|---|---|---|
| Pedidos a la sala (conexiones, acciones, mensajes) | 100.000 | ~5.000 a 10.000 |
| Filas escritas (mensajes, votos, ajustes) | 100.000 | ~10.000 |
| Filas leídas | 5.000.000 | unos cientos de miles |
| Tiempo de sala activa | 13.000 GB·s | ~1.800 (4 horas) |
| Espacio guardado | 5 GB en total | unos pocos MB |
| Páginas y archivos | sin límite | — |

Los mensajes que llegan de los celulares se cuentan 20 por pedido y los que salen hacia los celulares no se cobran: por eso rinde tanto. Con 150 personas se usa más o menos un 10% del cupo. Si algún día se pasara, el chat deja de responder hasta las 21:00. Para eventos mucho más grandes está el plan pago de Workers (USD 5 por mes).

Probado con 150 celulares simulados, cada uno con su cuenta, más un conductor: 550 mensajes en 45 segundos, ninguno perdido ni duplicado, el conductor los recibió todos, al público no le llegó ningún mensaje ajeno, y la encuesta dio exacta.

## Armar tu propia copia

Para usarlo en otro evento con tu propio sitio. Hace falta una compu con **Node.js 20 o más nuevo** (<https://nodejs.org>) y una **cuenta gratis de Cloudflare** (<https://dash.cloudflare.com/sign-up>). Son unos pocos comandos en la terminal, una sola vez:

```bash
git clone https://github.com/jorgechemez99-cell/brindis-bravo.git
```

```bash
cd brindis-bravo
```

```bash
npm install
```

```bash
npx wrangler login
```

(se abre el navegador para autorizar tu cuenta de Cloudflare)

```bash
npm run deploy
```

Al final muestra tu dirección, del estilo `https://brindis-bravo.TU-SUBDOMINIO.workers.dev`. Listo:

1. Abrí `TU-DIRECCIÓN/panel` y elegí la clave del admin (**¡Primera vez!**).
2. Armá tu equipo y tus programas.
3. Imprimí el QR desde la pestaña **QR**.
4. En la app de escritorio: globito → **Cambiar el servidor…** → pegá tu dirección → **Guardar**. La app la recuerda.

Para que la app venga apuntando a tu sitio desde el arranque, cambiá la dirección en `overlay/config.json` y armala de nuevo (ver abajo).

**Cambiar el nombre del evento**: el nombre "Brindis Bravo" aparece en las páginas de `public/` (títulos y cabeceras), en `overlay/main.js` y `overlay/empaquetar.mjs` (nombre de la app), y en `wrangler.jsonc` (`name`, que define la dirección).

## Para programadores

```bash
npm install
npm install --prefix overlay        # sólo para la app de escritorio
npm run dev                          # servidor local en http://localhost:8790
npm run carga                        # 150 celulares simulados contra el servidor local
npm run overlay:probar               # abre la app contra overlay/config.json
npm run overlay:empaquetar           # arma los .zip de Mac y Windows en overlay/dist/
npm run deploy                       # publica en Cloudflare (nunca durante un show)
```

- Para el servidor local, crear un archivo `.dev.vars` con `ADMIN_PASSWORD=una-clave` (sólo sirve mientras no se elija la clave del admin desde el panel).
- Para probar la app contra el servidor local: `BRINDIS_SERVIDOR=http://localhost:8790 npm run overlay:probar`.
- Prueba de carga contra un sitio publicado (no corre si hay celulares conectados; pide la clave del admin y al final borra lo que creó): `BASE=https://... npm run carga`.

**Cómo está hecho**

- `src/worker.js`: entrada. Manda la API y el WebSocket a la sala; el resto son archivos estáticos.
- `src/sala.js`: la **sala**, un único Durable Object de Cloudflare.
  - Guarda todo en SQLite: mensajes, cuentas, sesiones, encuestas, votos, sanciones, ajustes.
  - Reparte en vivo por WebSocket, con *hibernation*: no cobra mientras nadie habla.
  - Claves con PBKDF2 y cookies HttpOnly.
- `public/`: las páginas, sin frameworks.
  - `index.html` y `publico.js`: el chat del celu.
  - `panel.*`: el panel.
  - `pantalla.*`: la capa transparente; `pantalla-editar.js` es la edición con el mouse, que sólo se activa dentro de la app.
  - `comun.js`: la conexión que se reconecta sola, con latido y reintentos.
- `overlay/`: la app de escritorio (Electron).
  - Una ventana transparente, siempre arriba y que deja pasar los clics, más la botonera.
  - En Mac marca las ventanas como "estacionarias" con [koffi](https://koffi.dev), para que no se corran al mostrar el escritorio.
- `scripts/carga.mjs`: la prueba de carga.
