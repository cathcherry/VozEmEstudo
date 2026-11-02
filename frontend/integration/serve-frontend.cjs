/* Opcional: use somente se o servidor tiver uma lista fixa de páginas/rotas.
   Monte este router ANTES do middleware que responde NOT_FOUND.
   O caminho informado deve apontar para a pasta frontend deste ZIP. */
const path = require('node:path');
module.exports = function serveFrontend(express, frontendDirectory) {
  const router = express.Router();
  const root = path.resolve(frontendDirectory);
  router.use('/assets', express.static(path.join(root, 'assets')));
  router.use('/css', express.static(path.join(root, 'css')));
  router.use('/js', express.static(path.join(root, 'js')));
  router.use(express.static(path.join(root, 'pages')));
  return router;
};
