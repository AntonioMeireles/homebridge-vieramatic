import { XMLBuilder, XMLParser } from 'fast-xml-parser'

const xml2obj = (raw: string): Record<string, unknown> =>
  new XMLParser({
    numberParseOptions: {
      hex: true,
      leadingZeros: true,
      // workarounds fxp 3.20.0+ woes
      // encrypted payloads were sometimes being parsed as (!) bigNums
      skipLike: /^\S+=$/
    }
  }).parse(raw)

const xml = (data: unknown): string =>
  new XMLBuilder({ ignoreAttributes: false, processEntities: false }).build(data)

export { xml, xml2obj }
