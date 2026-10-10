// Hook electron-builder « afterPack » (voir electron-builder.yml).
//
// Sur Apple Silicon, tout binaire arm64 doit porter une signature, même ad hoc :
// sans elle macOS affiche « l'app est endommagée et ne peut pas être ouverte ».
// Le bundle d'Electron est signé ad hoc d'origine, mais electron-builder le modifie
// (Info.plist, app.asar...), ce qui invalide cette signature. Quand aucun certificat
// Apple n'est configuré (cas actuel : pas de compte développeur), electron-builder
// ne signe rien : on re-signe donc ad hoc ici. Avec un vrai certificat (CSC_LINK /
// CSC_NAME), electron-builder signe lui-même par-dessus et ce hook ne fait rien.
//
// Une signature ad hoc ne remplace PAS la notarisation : Gatekeeper demandera
// toujours « clic droit > Ouvrir » au premier lancement.
const { execFileSync } = require('child_process')
const path = require('path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.CSC_LINK || process.env.CSC_NAME) return

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log(`  • signature ad hoc (aucun certificat configuré) : ${appPath}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
