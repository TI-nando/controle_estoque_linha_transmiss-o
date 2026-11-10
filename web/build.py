import pathlib
d = pathlib.Path(__file__).parent
src = (d / 'index.src.html').read_text()
core = (d / 'core.js').read_text().replace("if (typeof module !== 'undefined') module.exports = Core;", '')
out = src.replace('/*CSS*/', (d / 'styles.css').read_text()).replace('/*CORE*/', core).replace('/*APP*/', (d / 'app.js').read_text())
(d / 'index.html').write_text(out)
print('index.html', len(out), 'bytes')
