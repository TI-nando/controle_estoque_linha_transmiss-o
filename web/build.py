"""Gera web/index.html (arquivo único) a partir dos fontes.

Miniaturas das torres: usa web/figuras.css se existir (desenhos do SEU projeto, fica fora do git)
ou, se não existir, web/figuras-genericas.css (desenhos genéricos, versionados).
"""
import pathlib
d = pathlib.Path(__file__).parent
src = (d / 'index.src.html').read_text()
fig = d / 'figuras.css'
if not fig.exists():
    fig = d / 'figuras-genericas.css'
core = (d / 'core.js').read_text().replace("if (typeof module !== 'undefined') module.exports = Core;", '')
sync = (d / 'sync.js').read_text().replace("if (typeof module !== 'undefined') module.exports = Sync;", '')
out = (src.replace('/*CSS*/', (d / 'styles.css').read_text() + fig.read_text())
          .replace('/*CORE*/', core + '\n' + sync)
          .replace('/*APP*/', (d / 'app.js').read_text()))
(d / 'index.html').write_text(out)
print('index.html', len(out), 'bytes')
