# Gastos fijos

Cuenta personal de gastos fijos mensuales. Es una web estática: se abre `index.html` en el navegador y, publicada, GitHub Pages sirve la raíz de `main`. No hay servidor ni base de datos.

**Estos datos son personales y sensibles.** El Excel en claro y cualquier JSON con importes no deben subirse al repositorio. En el sitio solo vive `data/gastos.enc`, cifrado. Si GitHub Pages queda público, ese archivo también lo es: la contraseña es la protección. Usa una frase larga y que no reutilices.

## Aviso en la interfaz

La pantalla de acceso y la cuenta muestran el mismo aviso: los datos no se envían a ningún servidor. Los cambios se guardan cifrados en este navegador.

## Cómo se usa

1. Si existe `data/gastos.enc`, la web pide «Introduce tu contraseña» y no muestra importes hasta descifrarlo.
2. Si ese archivo no está (o abres `index.html` como archivo local y el navegador no puede leerlo), aparece la preparación: importas el Excel y eliges una contraseña de al menos 8 caracteres. La copia queda cifrada en `localStorage`.
3. También puedes pulsar «Abrir un gastos.enc» y elegir el archivo en tu equipo.
4. Dentro ves los gastos por grupo, el coste al mes y al año, el total de cada grupo, el total del mes, el total del año (total mes × 12, como en la hoja) y el reparto en barras.
5. **Añadir gasto** pide nombre, grupo (uno nuevo se crea al escribirlo), importe mensual o anual, y fechas opcionales de alta y baja.
6. **Editar** cambia importe, tipo, grupo y fechas. **Dar de baja** pone la fecha de hoy y deja de sumar. **Reactivar** quita la baja. **Eliminar** borra la línea.
7. Eliminar un gasto, darlo de baja, borrar un grupo vacío, importar un Excel encima o sustituir la copia local piden confirmación.
8. Los totales se recalculan al guardar.
9. **Bloquear** vuelve a la contraseña. A los 15 minutos sin actividad también se bloquea.
10. El tema sigue al sistema y puedes fijarlo en claro u oscuro. Esa preferencia no es un dato de gastos.

En cada línea se ven alta, baja y último cambio. El Excel original no trae fechas: hasta que pulses «Marcar como revisados» aparece el aviso de datos sin revisión (más de 6 meses sin revisar se consideran desactualizados).

### Avisos de incoherencia

- Importe a 0 €.
- Nombres repetidos.
- El coste anual no cuadra con el mensual × 12 (más de un céntimo).
- Fecha de baja ya pasada: esa línea no entra en los totales.
- Sin fecha de revisión, o revisión de hace más de 6 meses.
- Grupos vacíos.
- Un subtotal escrito en la hoja (columna «Total / mes», o una fila «Total / mes») que no coincide con la suma de sus líneas. También si las filas Total o Total Año no cuadran.

## Dónde se guardan los cambios

GitHub Pages no puede escribir en el repositorio ni en Google Drive. Cada cambio se vuelve a cifrar con la misma clave (misma sal, nuevo vector de inicialización) y se guarda en `localStorage` bajo la clave `gastos.vault`.

Al entrar, si la copia del navegador es más reciente que `data/gastos.enc`, se usa la copia local. Si regeneras el archivo cifrado y su `updatedAt` es posterior, al desbloquear sustituye a la copia local más antigua.

**Exportar Gastos.xlsx** descarga la hoja en el navegador, ya descifrada. **Importar xlsx** sustituye los gastos de esta sesión, previa confirmación. **Descargar gastos.enc** baja el estado actual cifrado para copiarlo a `data/gastos.enc` y publicarlo.

## Formato de `data/gastos.enc`

UTF-8, JSON con este orden de campos:

```json
{
  "version": 1,
  "kdf": "PBKDF2-SHA256",
  "cipher": "AES-GCM",
  "keyBits": 256,
  "iterations": 310000,
  "salt": "<base64>",
  "iv": "<base64>",
  "ciphertext": "<base64>"
}
```

- `version` es 1.
- La contraseña es UTF-8. No se recorta ni se transforma.
- `salt` son 16 bytes aleatorios, en base64 estándar con relleno `=`.
- PBKDF2-SHA256 deriva una clave AES de 256 bits. `iterations` tiene que ser un entero **mayor o igual que 310000**. La web rechaza un archivo con menos.
- `iv` son 12 bytes aleatorios, en base64. Cada cifrado usa un IV nuevo.
- AES-GCM (etiqueta de 128 bits, la de WebCrypto). `ciphertext` es el resultado de `crypto.subtle.encrypt`: texto cifrado y etiqueta, en base64.
- El claro es JSON UTF-8. No va dentro del repositorio.

### JSON antes de cifrar

```json
{
  "version": 1,
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "reviewedAt": null,
  "groups": [
    {
      "id": "identificador",
      "name": "Nombre del grupo",
      "items": [
        {
          "id": "identificador",
          "name": "Nombre del gasto",
          "basis": "monthly",
          "monthly": 10,
          "yearly": 120,
          "startDate": null,
          "endDate": null,
          "updatedAt": null
        }
      ]
    }
  ]
}
```

`basis` es `monthly` (el anual es el mensual × 12), `yearly` (el mensual es el anual / 12) o `both` (los dos números se conservan porque no cuadran). `reviewedAt`, `startDate` y `endDate` son `AAAA-MM-DD` o `null`. `declaredSubtotal` en un grupo, si está, es el total mensual que traía la hoja y no coincidía con las líneas.

## Generar el archivo cifrado

Hace falta Node.js 18 o superior. No instala dependencias: SheetJS está en `vendor/`. La contraseña solo entra por el entorno, no como argumento.

```bash
GASTOS_PASSWORD='una frase larga' node scripts/encrypt.mjs ./ruta/gastos.xlsx
GASTOS_PASSWORD='una frase larga' node scripts/encrypt.mjs ./ruta/gastos.json
```

Escribe `data/gastos.enc`. Un tercer argumento cambia la ruta de salida. El script comprueba que el sobre se puede descifrar con la misma clave y no imprime importes ni la contraseña.

El Excel de origen usa la hoja `Gastos Fijos mensuales` si existe; si no, la primera hoja. Columnas: `Servicio`, `Coste / mes`, `Coste / año`, `Total / mes`. Una fila solo con el nombre abre un grupo. `Total` y `Total Año` cierran la hoja. La exportación añade `Alta`, `Baja` y `Último cambio` para no perder las fechas al volver a importar, y deja fórmulas de suma en los totales.

Comprobación técnica, con datos ficticios y sin tocar `data/`:

```bash
node scripts/self-check.mjs
```

## Publicar en GitHub Pages

No hace falta una acción de GitHub. En el repositorio: **Settings → Pages → Build and deployment → Deploy from a branch → Branch `main` y carpeta `/` (root)**.

El archivo `.nojekyll` evita que Jekyll oculte carpetas. `robots.txt` y la etiqueta `noindex` piden a los buscadores que no indexen el sitio; no sustituyen la contraseña.

Hasta que `data/gastos.enc` esté en `main`, la web publicada muestra la pantalla de preparación.

## En local

Con un servidor estático los enlaces relativos funcionan igual que en Pages:

```bash
python3 -m http.server 8765
```

Abre `http://127.0.0.1:8765/`. También puedes abrir `index.html` con doble clic: el navegador no deja leer `data/gastos.enc` desde `file://`, así que usa «Abrir un gastos.enc» o importa el Excel. El JavaScript del navegador es `js/app.bundle.js` (un solo archivo, sin módulos) para que ese doble clic funcione. Si cambias los módulos `js/*.mjs`, regenera el paquete con `npx esbuild js/app.mjs --bundle --format=iife --outfile=js/app.bundle.js`. Pages no necesita ese paso.

## Qué no subir

- `*.xlsx`, `*.xls`, `*.csv` y `data/*.json` están en `.gitignore`.
- No copies importes, nombres de gastos ni la contraseña al README, a incidencias ni al código.
- La preferencia de tema (`gastos.theme`) es lo único que se guarda sin cifrar.

## Créditos de terceros

- [SheetJS community](vendor/xlsx.LICENSE) 0.18.5, Apache-2.0, en `vendor/xlsx.full.min.js`.
- Source Sans 3 y Fraunces, SIL Open Font License, en `fonts/`.
