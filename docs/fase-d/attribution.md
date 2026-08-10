# Atribución del modelo anatómico

`apps/web/public/models/heart.glb` es obra derivada de **BodyParts3D**.

> BodyParts3D, Copyright© The Database Center for Life Science licensed by
> CC Attribution-Share Alike 2.1 Japan.

Esa frase es la atribución que la licencia exige literalmente, y hay que
reproducirla tal cual.

## Qué se ha derivado

Selección de nueve estructuras cardíacas del conjunto completo, unión de las
mallas de elemento que componen cada una, recorte de los árboles vasculares a
su porción extrapulmonar, renombrado al contrato de la fase D, recentrado de
cada nodo en su propio centro geométrico, normalización de escala y
exportación a glTF 2.0 binario. El procedimiento entero está en
`build-heart-model.py`; el detalle de qué se incluyó y por qué, en
`anatomy-source.md`.

## Qué obliga la licencia

**Compartir igual.** El `heart.glb` derivado se distribuye bajo la misma
licencia, CC BY-SA 2.1 Japón. Esto viaja con el fichero: si algún día el
proyecto deja de ser docente y se cierra o se comercializa, este modelo no
puede acompañarlo sin más y hay que sustituirlo.

**Atribuir de forma visible.** No basta con este fichero. Un usuario que ve el
corazón en pantalla tiene que poder saber de dónde sale sin ponerse a
inspeccionar el repositorio, así que la atribución debe aparecer también en la
interfaz. Es trabajo de la escena 3D (Task 11) y está pendiente.

## Enlaces

- BodyParts3D: <https://lifesciencedb.jp/bp3d/>
- Archivo de descarga (NBDC): <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html>
- CC BY-SA 2.1 Japón: <https://creativecommons.org/licenses/by-sa/2.1/jp/deed.es>
