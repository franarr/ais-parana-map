# Mapa AIS Paraná (San Lorenzo / Rosario / Del Guazú / Braga / Bella Vista)

## Paso a paso

### 1. Crear el repositorio
- En GitHub, creá un repo nuevo (público), por ejemplo `ais-parana-map`.
- Subí estos 3 elementos tal cual están, respetando la estructura de carpetas:
  ```
  .github/workflows/update-ais.yml
  data/latest.json
  index.html
  ```

### 2. Dar permiso de escritura al Action
El workflow necesita poder hacer `git push` para actualizar `data/latest.json`.
- Andá a **Settings → Actions → General** en tu repo.
- En "Workflow permissions" elegí **Read and write permissions**.
- Guardá.

### 3. Habilitar GitHub Pages
- **Settings → Pages**.
- Source: `Deploy from a branch`.
- Branch: `main` (o la que uses), carpeta `/ (root)`.
- Guardá. En un par de minutos tu mapa va a estar en `https://TU_USUARIO.github.io/ais-parana-map/`.

### 4. Probar el Action manualmente
No hace falta esperar los 10 minutos del cron la primera vez:
- Pestaña **Actions** → seleccioná "Actualizar datos AIS" → **Run workflow**.
- Cuando termine (ícono verde), revisá que `data/latest.json` en el repo tenga contenido real (no el placeholder vacío).

### 5. Esquema de los datos (ya resuelto)
Los JSON de AGPSE vienen en formato AIS crudo (protocolo ITU-R M.1371), no como
GeoJSON. Estructura de cada zona:

```json
{
  "x": -36435917,      // longitud del centro de la zona (grados * 600000)
  "y": -19630989,       // latitud del centro de la zona (grados * 600000)
  "tgts": {              // diccionario de objetivos, clave = MMSI
    "710027240": {
      "t": 0,             // tipo: 0/1 = buque, 3 = estación base, 4 = baliza/AtoN
      "a": 45350,         // antigüedad del último reporte, en segundos
      "x": -35491984,     // longitud * 600000
      "y": -20328470,     // latitud * 600000
      "s": 120,           // velocidad en décimos de nudo (120 = 12.0 nudos)
      "c": 2961,          // rumbo en décimos de grado (2961 = 296.1°)
      "n": "MERCOSUL ITAJAI"  // nombre (no siempre presente)
    }
  },
  "ts": 367149233
}
```

Para convertir a grados decimales: `lat = y / 600000`, `lon = x / 600000`.
Esto ya está implementado en `index.html` (función `decodeCoord`), no hace falta
tocar nada — pero si AGPSE cambia el formato en el futuro, ese es el lugar a ajustar.

### 6. (Opcional) Repo de datos separado
Si preferís que el bot no ensucie el historial de commits del repo de código (como
mencionaban en el chat), la variante es:
- Crear un segundo repo, por ejemplo `ais-parana-data`.
- Generar un **Personal Access Token** (classic, con permiso `repo`) o usar un
  **Fine-grained token** con acceso de escritura solo a ese repo.
- Guardarlo como **Secret** en el repo de código: `Settings → Secrets and variables →
  Actions → New repository secret`, nombre `DATA_REPO_TOKEN`.
- En `update-ais.yml`, descomentar el bloque de `checkout` que apunta a
  `TU_USUARIO/ais-parana-data` usando ese token, y ajustar el `git push` para que
  pushee ahí en vez de al repo de código.
- En `index.html`, cambiar `DATA_URL` por la URL raw de ese otro repo, por ejemplo:
  `https://TU_USUARIO.github.io/ais-parana-data/latest.json` (si también le
  activás Pages) o el link `raw.githubusercontent.com` correspondiente
  (este último puede tener CORS más restrictivo, conviene servirlo con Pages).

### 7. Frecuencia de actualización
El cron está en `*/10 * * * *` (cada 10 minutos). GitHub Actions en repos públicos
no cobra por esto, pero ten en cuenta que el cron de GitHub no es exacto al segundo
(puede haber unos minutos de demora bajo carga). Si necesitás algo más frecuente
que 5 minutos, GitHub no lo garantiza de forma confiable con `schedule`.

## Notas sobre CORS (opción A que se descartó)
Se evaluó hacer `fetch()` directo desde el navegador contra
`hidrografia.agpse.gob.ar`, pero no se pudo confirmar si el servidor manda
headers CORS (`Access-Control-Allow-Origin`) porque el sitio bloquea el acceso
automatizado usado para inspeccionarlo. Por eso se optó directamente por la
opción robusta (Action + archivo propio), que funciona sin importar si CORS
está habilitado o no del lado de AGPSE.

## Tipos de objetivo en el mapa
- **Círculo de color** (según zona): buques (`t=0` o `t=1`).
- **Rombo**: balizas / ayudas a la navegación, AtoN (`t=4`) — accesos, dolphins, etc.
- **Cuadrado chico**: estaciones base AIS (`t=3`).

Se pueden combinar los filtros por zona y por tipo de objetivo en el panel
superior izquierdo del mapa.
