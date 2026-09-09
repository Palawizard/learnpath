Une explication comme un LLM peut en produire, avec tout ce qu'on ne veut pas rendre.

<script>window.alert('xss')</script>

<img src="x" onerror="alert(1)">

<div onclick="alert(2)">du texte dans une balise brute</div>

![une image en data](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=)

![une image distante](https://exemple.invalid/pixel.png)

[un lien javascript](javascript:alert(3))

[un lien data](data:text/html,<script>alert(4)</script>)

[un lien normal](https://exemple.invalid/doc)

Du **gras**, de l'`inline code` et une liste :

- premier
- second

```js
const x = 1 < 2 && 3 > 2
```
