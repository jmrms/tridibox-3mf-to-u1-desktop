# Tridibox 3MF to U1 Desktop 1.2.1

Aplicación portátil para Windows que convierte archivos `.3mf` de Bambu
Studio, OrcaSlicer, PrusaSlicer, SuperSlicer y 3MF estándar al perfil de la
Snapmaker U1. La conversión funciona completamente en la computadora y no
requiere Internet.

## Funciones

- Un único EXE portátil; no requiere instalación ni una carpeta de DLL.
- Apertura manual, arrastrar y soltar y uso mediante "Abrir con".
- Vigilancia automática de una carpeta, normalmente Descargas.
- Inicio opcional con Windows y funcionamiento en la bandeja.
- Detección de archivos Bambu/Orca, Prusa/SuperSlicer y 3MF estándar.
- Detección de archivos ya configurados para Snapmaker U1.
- Conservación byte por byte de la geometría, la pintura y los recursos que no
  forman parte de los metadatos convertidos.
- Asignación visual de cualquier cantidad de colores a las cuatro ranuras U1.
- Reordenamiento de ranuras mediante arrastrar y soltar.
- Selector con 56 colores predefinidos y entrada hexadecimal.
- Perfiles completos de PLA, PETG-HF, ABS y TPU tomados de Snapmaker Orca.
- Perfil de máquina `Snapmaker U1 (0.4 nozzle)` y tres procesos optimizados:
  muy buena calidad a 0,16 mm, estándar a 0,20 mm y rápida a 0,28 mm.
- Verificación obligatoria del resultado antes de guardarlo.
- Apertura directa del resultado mediante **Abrir en Snapmaker Orca**.
- Activación de soportes cuando se detectan en el archivo original.
- Conversión automática opcional para archivos de un solo color.
- Nombre de salida `Nombre-U1.3mf` y opción de guardar una copia original.
- Protección contra ZIP bomb, rutas internas peligrosas y archivos de más de 2 GB.

## Uso del EXE portátil

1. Guarde `Tridibox-3MF-to-U1-Desktop-1.2.1-Portable.exe` en una carpeta fija.
2. Ejecútelo; Windows puede tardar unos segundos mientras prepara la aplicación.
3. Arrastre un `.3mf` sobre la ventana.
4. Elija **Muy buena calidad (0,16 mm)**, **Calidad estándar (0,20 mm)** o
   **Calidad rápida (0,28 mm)**. Todas utilizan boquilla de 0,4 mm.
5. Revise la asignación y presione **Convertir y guardar**.
6. Cuando aparezcan las comprobaciones aprobadas, use **Abrir en Snapmaker Orca**.
7. Revise los parámetros y vuelva a laminar antes de imprimir.

La primera vez que se usa el botón de Orca, si el programa no se encuentra en
una ubicación habitual, se solicita seleccionar `Snapmaker Orca.exe`. La ruta
queda guardada localmente.

## Qué verifica la aplicación

Antes de permitir guardar el resultado comprueba:

- que el contenedor 3MF sea válido y no contenga rutas internas peligrosas;
- que el destino sea la U1 con boquilla de 0,4 mm y el proceso incluido;
- que existan entre una y cuatro herramientas físicas;
- que colores, materiales y todos los parámetros oficiales coincidan;
- que las asignaciones XML sean válidas y estén dentro del rango 1–4;
- que la geometría, la pintura y los archivos no convertidos sean idénticos al
  original, comparados byte por byte.

Si falla una comprobación, no se guarda el archivo convertido.

## Vigilancia automática

En Configuración, active la vigilancia y elija la carpeta Descargas. El programa
espera a que el archivo termine de escribirse antes de abrirlo. Los archivos que
terminan en `-U1.3mf` se ignoran para evitar ciclos.

Si activa **Mantener en la bandeja**, cerrar la ventana no termina la aplicación.
Para cerrarla por completo, utilice **Salir** desde el icono de la bandeja.

Para **Iniciar con Windows**, conserve el EXE en su ubicación definitiva antes
de activar la opción. La aplicación registra ese EXE portátil y se inicia oculta
cuando la vigilancia está habilitada.

## Perfiles incluidos

La versión 1.2.1 incluye la instantánea oficial de perfiles Snapmaker
`02.03.03.03`, commit `ded5297bc7349d6a398a06943ee3bc5dfab52ae3` de Snapmaker
Orca. Se incorporan los parámetros resueltos de máquina, proceso, temperaturas,
cama, refrigeración, caudal, avance de presión, retracción y cambio de herramienta.
Para la boquilla de 0,4 mm se ofrecen solamente las alturas solicitadas:

- 0,16 mm: muy buena calidad. Conserva las 6 capas superiores, 4 inferiores,
  relleno Gyroid y alturas del proceso oficial 0,16 mm; para mejorar el acabado
  usa del proceso oficial High Quality paredes exteriores a 60 mm/s, interiores
  a 150 mm/s, superficies superiores a 150 mm/s, relleno a 200 mm/s,
  aceleración general de 4000 mm/s² y exterior de 2000 mm/s²;
- 0,20 mm: calidad estándar y opción predeterminada;
- 0,28 mm: calidad rápida y máxima altura oficial para esa boquilla.

El perfil estándar conserva sus velocidades oficiales elevadas en paredes
internas, relleno y viajes. No se aumentaron por encima de esos valores porque
eso podría degradar la calidad; el caudal máximo oficial de cada material sigue
limitando la velocidad efectiva.

## Compilar desde el código fuente

Requiere Node.js y npm:

```powershell
npm install
npm test
npm run package:win
```

El EXE portátil y el ZIP de código fuente se generan dentro de `release`.
Para regenerar los perfiles desde un árbol local de Snapmaker Orca:

```powershell
npm run profiles:generate -- C:\ruta\OrcaSlicer\resources\profiles\Snapmaker
```

## Publicar en GitHub desde Windows

El paquete de publicación incluye `Publicar-en-GitHub.cmd`. Al ejecutarlo usa
el navegador predeterminado para autorizar GitHub una sola vez, crea el
repositorio público, sube el código y publica la release `v1.2.1` con el EXE y
el ZIP de código fuente. El publicador funciona directamente en CMD y puede
continuar si el repositorio ya fue creado por una ejecución anterior. Las
credenciales no se escriben dentro del proyecto.

## Alcance de la conversión

El programa modifica `Metadata/slice_info.config`,
`Metadata/model_settings.config` y `Metadata/project_settings.config`. La
geometría y los demás archivos se copian sin cambios. Ciertos ajustes del
laminador original se reemplazan por el perfil oficial de destino.

Siempre abra el resultado en Snapmaker Orca, compruebe materiales, temperatura,
soportes y orientación, y vuelva a laminar antes de imprimir.

## Privacidad

No realiza solicitudes de red ni envía archivos a servidores. La configuración
se guarda en el perfil local del usuario de Windows.

Consulte la política completa en [`PRIVACY.md`](PRIVACY.md) y el procedimiento
para reportar vulnerabilidades en [`SECURITY.md`](SECURITY.md).

## Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io/), certificate
by [SignPath Foundation](https://signpath.org/).

Las responsabilidades, la compilación verificable y la aprobación manual de
cada versión se documentan en
[`CODE_SIGNING_POLICY.md`](CODE_SIGNING_POLICY.md).

## Licencia y atribución

La distribución combinada se publica bajo GNU Affero General Public License v3.
El motor deriva de [3mf-to-u1](https://github.com/ericreid/3mf-to-u1) de Eric
Reid, que deriva de `bl2u1` de Josuan Benedicto. Los perfiles proceden de
[Snapmaker Orca](https://github.com/Snapmaker/OrcaSlicer). Consulte `LICENSE` y
`NOTICE`.
