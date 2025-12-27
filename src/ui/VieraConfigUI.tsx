import { faTv, faCartPlus, faTrash } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon as Icon } from '@fortawesome/react-fontawesome'
import { IHomebridgeUiFormHelper } from '@homebridge/plugin-ui-utils/ui.interface'
import { batch, signal, useSignalEffect } from '@preact/signals'
import { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/compat'
import { Alert, Button, Form } from 'react-bootstrap'

import { UserConfig } from '../accessory'
import { sleep, isValidIPv4, Abnormal, dupeChecker, isSame, prettyPrint } from '../helpers'
import { VieraAuth, VieraSpecs } from '../viera'

import {
  authLayout,
  commonFormLayout,
  commonSchema,
  tvAddressSchema,
  pinRequestSchema
} from './forms'
import { Header } from './imagery'
import { InitialState, PluginConfig, Selected } from './state'

const { homebridge } = window

// -----------------------------------------------------------------------------
// Global signals (replaces hookstate(InitialState))
// -----------------------------------------------------------------------------
const abnormalSig = signal<boolean>(InitialState.abnormal)
const killSwitchSig = signal<boolean>(InitialState.killSwitch)
const loadingSig = signal<boolean>(InitialState.loading)
const pluginConfigSig = signal<PluginConfig>(InitialState.pluginConfig)
const frontPageSig = signal<boolean>(InitialState.frontPage)
const selectedSig = signal<Selected | null>()

const patchSelected = (patch: Partial<Selected>) => {
  const current = selectedSig.value
  if (!current) return
  selectedSig.value = { ...current, ...patch }
}

const enum actionType {
  create = 'added',
  update = 'changed',
  delete = 'deleted',
  none = 'unchanged'
}

const updateGlobalConfig = async (discover = false) => {
  const bareMinimal = new PluginConfig()
  const pluginConfig = await homebridge
    .getPluginConfig()
    .catch(() => [bareMinimal])
    .then((found): PluginConfig[] => {
      found.length === 0 && found.push(bareMinimal)
      return found as unknown as PluginConfig[]
    })
    .then((found) => {
      const [cfg] = found
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      cfg.tvs ??= []
      return cfg
    })

  const abnormal = Abnormal(dupeChecker(pluginConfig.tvs))

  batch(() => {
    abnormalSig.value = abnormal
    killSwitchSig.value = abnormal
    loadingSig.value = false
    pluginConfigSig.value = pluginConfig
  })

  if (!abnormal && discover) {
    loadingSig.value = true
    const around = (await homebridge.request('/discover')) as string[]
    const found = around.filter((t) => !pluginConfig.tvs.some((e) => e.ipAddress === t))
    const fn = (ip: string): UserConfig => ({ hdmiInputs: [], ipAddress: ip })

    if (found.length > 0) {
      const discovered = found.map((ip: string) => fn(ip))
      await homebridge.updatePluginConfig([new PluginConfig([...pluginConfig.tvs, ...discovered])])
      await homebridge.savePluginConfig()

      for (const ip of found)
        homebridge.toast.info(
          `A new Panasonic Viera TV was discovered at ${ip}, on your network, and added to your homebridge. Click it to finish its' setup.`
        )

      await updateGlobalConfig(false)
    } else loadingSig.value = false
  }
}

const updateHomebridgeConfig = async (ip: string, next: UserConfig[], type: actionType) => {
  if (type !== actionType.none) {
    await homebridge.updatePluginConfig([new PluginConfig([...next])])
    await homebridge.savePluginConfig()
    await updateGlobalConfig(false)
  }
  homebridge.toast.success(`${ip} ${type}.`)
}

// https://dev.to/bytebodger/constructors-in-functional-components-with-hooks-280m
const useSingleton = (callBack = () => void 0): void => {
  const hasBeenCalled = useRef(false)
  if (hasBeenCalled.current) return
  callBack()
  hasBeenCalled.current = true
}

const Body = () => {
  useSingleton(() => void (async (): Promise<void> => await updateGlobalConfig())())

  useSignalEffect(() => {
    if (loadingSig.value) homebridge.showSpinner()
    else homebridge.hideSpinner()
  })

  useEffect(() => void 0, [])

  const request = async (path: string, body?: unknown) => {
    loadingSig.value = true
    return await homebridge.request(path, body).finally(() => (loadingSig.value = false))
  }

  const previousConfig = (ip: string): UserConfig | undefined => {
    const existing = pluginConfigSig.value.tvs as unknown as UserConfig[]
    return existing.find((o) => o.ipAddress === ip)
  }

  const backToMain = (form?: IHomebridgeUiFormHelper) => {
    if (form) form.end()
    batch(() => {
      frontPageSig.value = true
      selectedSig.value = undefined
    })
  }

  const onEdition = async (raw?: string): Promise<void> => {
    const pair = (challenge: string, tv: UserConfig) => {
      const pinForm = homebridge.createForm(pinRequestSchema, undefined, 'Next', 'Cancel')
      pinForm.onCancel(pinForm.end)
      pinForm.onSubmit(async (data) => {
        await request('/pair', { challenge, ip: tv.ipAddress, pin: data.pin })
          .then(async (auth: VieraAuth) => {
            const body = JSON.stringify({ ...tv, appId: auth.appId, encKey: auth.key })
            const specs: VieraSpecs = await request('/specs', body)
            return { auth, specs }
          })
          .then((payload) => {
            const config = { ...tv, appId: payload.auth.appId, encKey: payload.auth.key }
            selectedSig.value = {
              config,
              onHold: false,
              reachable: true,
              specs: payload.specs
            }
            return
          })
          .catch(() => {
            homebridge.toast.error('Wrong PIN...', tv.ipAddress)
            backToMain()
          })
          .finally(pinForm.end)
      })
    }

    if (raw) {
      batch(() => {
        selectedSig.value = {
          config: JSON.parse(raw),
          onHold: true,
          reachable: false,
          specs: undefined
        }
        frontPageSig.value = false
      })
    } else {
      frontPageSig.value = false
      const tvForm = homebridge.createForm(tvAddressSchema, undefined, 'Next', 'Cancel')
      tvForm.onCancel(() => backToMain(tvForm))

      tvForm.onSubmit(async (data) => {
        if (isValidIPv4(data.ipAddress)) {
          if (previousConfig(data.ipAddress))
            homebridge.toast.error('Trying to add an already configured TV set!', data.ipAddress)
          else {
            tvForm.end()
            const config = { hdmiInputs: [], ipAddress: data.ipAddress }
            selectedSig.value = {
              config,
              onHold: true,
              reachable: false,
              specs: undefined
            }
          }
        } else homebridge.toast.error('Please insert a valid IP address...', data.ipAddress)
      })
    }

    while (!selectedSig.value?.config) await sleep(250)
    const tv = selectedSig.value!.config

    await request('/ping', tv.ipAddress).then(async (reachable: boolean) => {
      /* eslint-disable promise/no-nesting*/
      if (!reachable) return patchSelected({ onHold: false, reachable })

      return await request('/specs', JSON.stringify(tv))
        .then((specs) => patchSelected({ onHold: false, reachable, specs }))
        .catch(
          async () => await request('/pin', tv.ipAddress).then((challenge) => pair(challenge, tv))
        )
    })
  }

  const onDeletion = (raw: string) => {
    batch(() => {
      frontPageSig.value = false
      selectedSig.value = {
        config: JSON.parse(raw),
        onHold: false,
        reachable: false,
        specs: undefined
      }
    })
  }

  const FrontPage = () => {
    const flip = () => !abnormalSig.value && (killSwitchSig.value = !killSwitchSig.value)
    const label = `${killSwitchSig.value ? 'deletion' : 'edition'} mode`
    const doIt = (tv: string) => (killSwitchSig.value ? onDeletion(tv) : onEdition(tv))

    const KillBox = () =>
      pluginConfigSig.value.tvs.length === 0 ? (
        <></>
      ) : abnormalSig.value ? (
        <Alert variant="warning" className="d-flex justify-content-center mt-3 mb-5">
          <b>more than one TV with same IP address found: please delete the bogus ones!</b>
        </Alert>
      ) : (
        <Form className="d-flex justify-content-end mt-3 mb-5">
          <Form.Switch onChange={flip} id="kS" label={label} checked={killSwitchSig.value} />
        </Form>
      )

    const style = { height: '4em', margin: '.25em', width: '10em' }

    const AddNew = () =>
      killSwitchSig.value ? (
        <></>
      ) : (
        <div className="d-flex justify-content-center mt-3 mb-5">
          <Button
            className="my-4"
            variant="primary"
            onClick={async () => await onEdition()}
            style={style}
          >
            <Icon size="sm" icon={faTv} /> <br />
            <Icon size="lg" icon={faCartPlus} />
          </Button>
        </div>
      )

    const Available = () => {
      const variant = killSwitchSig.value ? 'danger' : 'info'
      const onClick = (tv: UserConfig) => doIt(JSON.stringify(tv))
      const tvs = pluginConfigSig.value.tvs.map((tv, index) => (
        <Button
          variant={variant}
          style={style}
          key={index}
          onClick={() => onClick(tv as UserConfig)}
        >
          <Icon size="lg" icon={killSwitchSig.value ? faTrash : faTv} />
          <br /> {tv.ipAddress}
        </Button>
      ))
      return <>{tvs}</>
    }

    return (
      <section className="mh-100">
        <KillBox /> <Available /> <AddNew />
      </section>
    )
  }

  const Results = (props: { selected: Selected | null | undefined }) => {
    const selected = props.selected
    if (!selected || selected.onHold) return <></>

    const Offline = (props: { selected: Selected }) => (
      <Alert variant="danger" className="mt-3">
        <Alert.Heading>
          The Viera TV at <b>{props.selected.config.ipAddress}</b> could not be edited.
        </Alert.Heading>
        <hr />
        <p className="mb-2">
          Please, do make sure that it is <b>turned on</b> and <b>connected to the network</b>, and
          then try again.
        </p>
        <div className="mt-4 w-75 mx-auto">
          <p className="text-left ">
            Also, <b>if you haven't done it already</b>...
          </p>
          <p className="text-left">
            ...on your TV go to <b>Menu / Network / TV Remote App Settings</b> and make sure that
            the following settings are <b>all</b> turned <b>ON</b>:
            <ul className="mt-2">
              <li>
                <b>TV Remote</b>
              </li>
              <li>
                <b>Powered On by Apps</b>
              </li>
              <li>
                <b>Networked Standby</b>
              </li>
            </ul>
          </p>
        </div>
        <div className="d-flex justify-content-end mt-5">
          <Button onClick={() => backToMain()} variant="primary">
            OK
          </Button>
        </div>
      </Alert>
    )

    const ConfirmDeletion = (props: { selected: Selected }) => {
      const { ipAddress } = props.selected.config
      const nxt = pluginConfigSig.value.tvs.filter((o) => o.ipAddress !== ipAddress)
      const dropIt = async () =>
        await updateHomebridgeConfig(
          ipAddress,
          nxt as unknown as UserConfig[],
          actionType.delete
        ).then(() => backToMain())

      return (
        <Alert variant="danger" className="mt-3">
          <Alert.Heading>
            The Viera TV at <b>{ipAddress}</b> is about to be deleted from this Homebridge.
          </Alert.Heading>
          <hr />
          <div className="d-flex justify-content-center">
            <div className="w-75">
              <p className="mb-2">Please, make sure you know what you are doing...</p>
              <hr />
              <pre class="text-monospace text-left bg-light p-2">
                {prettyPrint(props.selected.config)}
              </pre>
              <hr />
            </div>
          </div>
          <div className="d-flex justify-content-end mt-1">
            <Button onClick={() => backToMain()} variant="primary">
              Cancel
            </Button>
            <Button onClick={() => dropIt()} variant="danger">
              Delete
            </Button>
          </div>
        </Alert>
      )
    }

    const Editor = (props: { selected: Selected }) => {
      const selected = props.selected

      if (selected.specs?.requiresEncryption && !commonFormLayout.includes(authLayout))
        commonFormLayout.splice(1, 0, authLayout)

      const schema = { layout: commonFormLayout, schema: commonSchema }
      const data = selected.config
      const tvform = homebridge.createForm(schema, data, 'Submit', 'Cancel')

      tvform.onCancel(() => backToMain(tvform))

      tvform.onSubmit(async (submited) => {
        const queued = submited as UserConfig
        loadingSig.value = true
        backToMain(tvform)

        const before = previousConfig(queued.ipAddress)
        let [others, type] = [[] as UserConfig[], actionType.none]

        if (!isSame(before, queued)) {
          const modded = before !== undefined
          const { tvs } = pluginConfigSig.value as unknown as PluginConfig
          others = modded ? tvs.filter((v) => v.ipAddress != queued.ipAddress) : []
          type = modded ? actionType.update : actionType.create
        }

        await updateHomebridgeConfig(queued.ipAddress, [...others, queued], type).finally(() => {
          loadingSig.value = false
        })
      })

      return <></>
    }

    if (killSwitchSig.value) return <ConfirmDeletion selected={selected} />
    if (selected.reachable) return <Editor selected={selected} />
    return <Offline selected={selected} />
  }

  return frontPageSig.value ? <FrontPage /> : <Results selected={selectedSig.value} />
}

const Template = (props: { children: ComponentChildren }) => (
  <main className="align-items-center text-center align-content-center">{props.children}</main>
)

const VieraConfigUI = () => (
  <Template>
    <Header />
    <Body />
  </Template>
)

export default VieraConfigUI
