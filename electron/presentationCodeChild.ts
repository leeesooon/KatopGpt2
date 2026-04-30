import fs from 'fs'
import { createRequire } from 'module'
import path from 'path'
import pptxgen from 'pptxgenjs'

async function main() {
  const inputPath = process.argv[2]
  const outputPath = process.argv[3]
  const generatedModulePath = process.argv[4]

  if (!inputPath || !outputPath || !generatedModulePath) {
    throw new Error('缺少 PPT 代码执行参数。')
  }

  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
  const generatedRequire = createRequire(path.resolve(generatedModulePath))
  const generatedModule = generatedRequire(path.resolve(generatedModulePath))
  const builder = generatedModule.buildPresentation
    || (generatedModule.default && generatedModule.default.buildPresentation)
    || generatedModule.default

  if (typeof builder !== 'function') {
    throw new Error('生成代码必须导出 buildPresentation 函数。')
  }

  const result = await builder({
    pptxgen,
    input,
    assets: Array.isArray(input.files) ? input.files : [],
    outputPath,
    workDir: path.dirname(path.resolve(generatedModulePath)),
  })

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    if (result && typeof result.writeFile === 'function') {
      await result.writeFile({ fileName: outputPath })
    } else if (result && result.pptx && typeof result.pptx.writeFile === 'function') {
      await result.pptx.writeFile({ fileName: outputPath })
    }
  }

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    throw new Error('生成代码执行完成，但没有写出有效的 PPTX 文件。')
  }

  console.log(JSON.stringify({
    ok: true,
    title: result && result.title,
    slideCount: result && result.slideCount,
  }))
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error))
  process.exitCode = 1
})
