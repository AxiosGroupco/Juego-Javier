# ¿Quién es Humano? 🤖

Juego multijugador en tiempo real donde el humano responde primero y los bots imitan su estilo para confundir al interrogador.

## Cómo desplegarlo gratis en Railway (5 minutos)

### Paso 1 — Sube el código a GitHub
1. Ve a https://github.com/new y crea un repositorio nuevo (puede ser privado)
2. Sube esta carpeta completa (`humano-game`) al repositorio

### Paso 2 — Despliega en Railway
1. Ve a https://railway.app y entra con tu cuenta de GitHub
2. Clic en **"New Project"** → **"Deploy from GitHub repo"**
3. Selecciona tu repositorio
4. Railway detecta automáticamente que es Node.js y lo despliega

### Paso 3 — Obtén el link
1. En Railway, ve a tu proyecto → pestaña **"Settings"** → **"Networking"**
2. Haz clic en **"Generate Domain"**
3. Te da un link tipo: `https://humano-game-production.up.railway.app`
4. ¡Comparte ese link con tu pareja!

---

## Cómo jugar

### Tú (el humano):
1. Entra al link → **"Crear sala"** → escribe tu nombre
2. Te aparece un código de 5 letras (ej: `AB3KX`)
3. Envíale ese código a tu pareja

### Tu pareja (el interrogador):
1. Entra al mismo link → **"Unirse"** → escribe nombre + código
2. Espera que tú inicies la partida

### Flujo de cada ronda:
1. El interrogador escribe una pregunta
2. **Tú respondes primero** (el interrogador espera)
3. Los bots leen tu respuesta y generan 2 respuestas similares pero con variaciones
4. El interrogador ve las 3 respuestas mezcladas y debe adivinar cuál es la tuya
5. Se revela el resultado y suma puntos

### Puntos:
- **Interrogador** gana 1 punto si encuentra al humano
- **Humano** gana 1 punto si engaña al interrogador

---

## Estructura del proyecto

```
humano-game/
├── server.js          # Servidor Node.js + Socket.io
├── package.json       # Dependencias
├── public/
│   └── index.html     # Interfaz completa del juego
└── README.md          # Este archivo
```

## Tecnologías
- **Backend**: Node.js + Express + Socket.io (tiempo real)
- **Frontend**: HTML + CSS + JS vanilla
- **IA**: Claude API (claude-sonnet) para generar respuestas de bots
