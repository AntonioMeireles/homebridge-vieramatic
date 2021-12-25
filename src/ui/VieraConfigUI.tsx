import { faTv, faCartPlus, faTrash } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon as Icon } from '@fortawesome/react-fontawesome'
import { IHomebridgeUiFormHelper } from '@homebridge/plugin-ui-utils/dist/ui.interface'
import { createState, none, State, useState } from '@hookstate/core'
import { ComponentChildren } from 'preact'
import { useEffect } from 'preact/compat'
import { Alert, Button, Form } from 'react-bootstrap'

import { UserConfig } from '../accessory'
import { sleep, isValidIPv4, Abnormal, dupeChecker, isSame } from '../helpers'
import { VieraAuth, VieraSpecs } from '../viera'

import {
  authLayout,
  commonFormLayout,
  commonSchema,
  tvAddressSchema,
  pinRequestSchema
} from './forms'
import { Header } from './imagery'
import { objPurifier, InitialState, Selected } from './state'

const globalState = createState(InitialState)

const enum actionType {
  create = 'added',
  update = 'changed',
  delete = 'deleted',
  none = 'unchanged'
}

const { homebridge } = window

const updateGlobalConfig = async () => {
  const pluginConfig = (await homebridge.getPluginConfig())[0]
  pluginConfig.tvs ??= []
  const abnormal = !!Abnormal(dupeChecker(pluginConfig.tvs))
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore ts(2739)
  globalState.merge({ abnormal, killSwitch: abnormal, loading: false, pluginConfig })
}

const updateHomebridgeConfig = async (ip: string, next: UserConfig[], type: actionType) => {
  if (type !== actionType.none) {
    await homebridge.updatePluginConfig([{ platform: 'PanasonicVieraTV', tvs: [...next] }])
    await homebridge.savePluginConfig()
    await updateGlobalConfig()
  }
  homebridge.toast.success(`${ip} ${type}.`)
}

const useSingleton = (callBack = () => undefined): void => {
  const hasBeenCalled = useState(false)
  if (hasBeenCalled.value) return
  callBack()
  hasBeenCalled.set(true)
}

const Body = () => {
  useSingleton(() => void (async (): Promise<void> => await updateGlobalConfig())())
  const state = useState(globalState)

  useEffect(
    () => (state.loading.value ? homebridge.showSpinner() : homebridge.hideSpinner()),
    [state.loading.value]
  )

  const request = async (path: string, body?: unknown) => {
    state.loading.set(true)
    return await homebridge.request(path, body).finally(() => state.loading.set(false))
  }

  const previousConfig = (ip: string): UserConfig | undefined =>
    state.pluginConfig.tvs.value.find((o) => o.ipAddress === ip)

  const backToMain = (form?: IHomebridgeUiFormHelper) => {
    if (form) form.end()
    state.merge({ frontPage: true, selected: none })
  }

  const onEdition = async (raw?: string): Promise<void> => {
    const pair = (challenge: string) => {
      const pinForm = homebridge.createForm(pinRequestSchema, null, 'Next', 'Cancel')
      pinForm.onCancel(pinForm.end)
      pinForm.onSubmit(
        async (data) =>
          await request('/pair', { challenge, ip: tv.ipAddress, pin: data.pin })
            .then(async (auth: VieraAuth) => {
              const body = JSON.stringify({ ...tv, appId: auth.appId, encKey: auth.key })
              const specs: VieraSpecs = await request('/specs', body)
              return { auth, specs }
            })
            // eslint-disable-next-line promise/always-return
            .then((payload) => {
              const config = { ...tv, appId: payload.auth.appId, encKey: payload.auth.key }
              state.selected.merge({ config, onHold: false, reachable: true, specs: payload.specs })
            })
            .catch(() => {
              homebridge.toast.error('Wrong PIN...', tv.ipAddress)
              backToMain()
            })
            .finally(pinForm.end)
      )
    }

    if (!raw) {
      state.frontPage.set(false)
      const newTvForm = homebridge.createForm(tvAddressSchema, null, 'Next', 'Cancel')
      newTvForm.onCancel(() => backToMain(newTvForm))

      newTvForm.onSubmit(async (data) => {
        if (isValidIPv4(data.ipAddress)) {
          if (previousConfig(data.ipAddress))
            homebridge.toast.error('Trying to add an already configured TV set!', data.ipAddress)
          else {
            newTvForm.end()
            const config = { hdmiInputs: [], ipAddress: data.ipAddress }
            state.selected.merge({ config, onHold: true })
          }
        } else homebridge.toast.error('Please insert a valid IP address...', data.ipAddress)
      })
    } else
      state.batch((s) => {
        s.selected.merge({ config: JSON.parse(raw), onHold: true }), s.frontPage.set(false)
      })

    while (state.selected.value?.config == null) await sleep(250)
    const tv = state.selected.value.config
    await request('/ping', tv.ipAddress).then(async (reachable: boolean) => {
      /* eslint-disable promise/no-nesting*/
      if (!reachable) return state.selected.merge({ onHold: false, reachable })
      return await request('/specs', JSON.stringify(tv))
        .then((specs) => state.selected.merge({ onHold: false, reachable, specs }))
        .catch(async () => await request('/pin', tv.ipAddress).then((challenge) => pair(challenge)))
    })
  }

  const onDeletion = (raw: string) =>
    state.batch((s) => {
      s.frontPage.set(false), s.selected.merge({ config: JSON.parse(raw), onHold: false })
    })

  const FrontPage = () => {
    const flip = () => !state.abnormal.value && state.killSwitch.set((k) => !k)
    const label = `${state.killSwitch.value ? 'deletion' : 'edition'} mode`
    const doIt = (tv: string) => (state.killSwitch.value ? onDeletion(tv) : onEdition(tv))
    const KillBox = () =>
      !state.pluginConfig.value.tvs.length ? null : state.abnormal.value ? (
        <Alert variant="warning" className="d-flex justify-content-center mt-3 mb-5">
          <b>more than one TV with same IP address found: please delete the bogus ones!</b>
        </Alert>
      ) : (
        <Form className="d-flex justify-content-end mt-3 mb-5">
          <Form.Switch onChange={flip} id="kS" label={label} checked={state.killSwitch.value} />
        </Form>
      )
    const style = { height: '4em', width: '10em' }
    const AddNew = () =>
      state.killSwitch.value ? null : (
        <div className="d-flex justify-content-center mt-3 mb-5">
          <Button
            className="my-4"
            variant="primary"
            onClick={async () => await onEdition()}
            style={style}
          >
            <Icon fixedWidth size="sm" icon={faTv} /> <br />
            <Icon fixedWidth size="lg" icon={faCartPlus} />
          </Button>
        </div>
      )
    const Available = () => {
      const variant = state.killSwitch.value ? 'danger' : 'info'
      const onClick = (tv: UserConfig) => doIt(JSON.stringify(tv))
      const tvs = state.pluginConfig.value.tvs.map((tv, idx) => (
        <Button variant={variant} style={style} key={idx} onClick={() => onClick(tv)}>
          <Icon fixedWidth size="lg" icon={state.killSwitch.value ? faTrash : faTv} />
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

  const Results = (props: { selected: State<Selected> | undefined }) => {
    if (!props.selected || props.selected.onHold.value) return null

    const Offline = (props: { selected: State<Selected> }) => (
      <Alert variant="danger" className="mt-3">
        <Alert.Heading>
          The Viera TV at <b>{props.selected.config.ipAddress.value}</b> could not be reached.
        </Alert.Heading>
        <hr />
        <p className="mb-2">
          Please, do make sure that it is <b>turned on</b> and <b>connected to the network</b>, and
          then try again.
        </p>
        <div className="d-flex justify-content-end mt-5">
          <Button onClick={() => backToMain()} variant="primary">
            OK
          </Button>
        </div>
      </Alert>
    )

    const ConfirmDeletion = (props: { selected: State<Selected> }) => {
      const { ipAddress } = props.selected.config.value
      const nxt = objPurifier(state.pluginConfig.value.tvs.filter((o) => o.ipAddress !== ipAddress))
      const dropIt = async () =>
        await updateHomebridgeConfig(ipAddress, nxt, actionType.delete).then(() => backToMain())

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
                {JSON.stringify(props.selected.config.value, undefined, 2)}
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

    const Editor = (props: { selected: State<Selected> }) => {
      if (props.selected.specs?.ornull?.requiresEncryption.value)
        commonFormLayout.splice(1, 0, authLayout)

      const schema = { layout: commonFormLayout, schema: commonSchema }
      const data = objPurifier(props.selected.config.value)
      const tvform = homebridge.createForm(schema, data, 'Submit', 'Cancel')
      tvform.onCancel(() => backToMain(tvform))
      tvform.onSubmit(async (submited) => {
        const queued = submited as UserConfig
        state.loading.set(true)
        backToMain(tvform)
        const before = previousConfig(queued.ipAddress)
        let [others, type] = [[] as UserConfig[], actionType.none]

        if (!isSame(before, queued)) {
          const modded = before != null
          const { tvs } = state.pluginConfig.value
          others = modded ? objPurifier(tvs.filter((v) => v.ipAddress != queued.ipAddress)) : []
          type = modded ? actionType.update : actionType.create
        }
        await updateHomebridgeConfig(queued.ipAddress, [...others, queued], type).finally(() =>
          state.loading.set(false)
        )
      })
      return null
    }

    if (state.killSwitch.value) return <ConfirmDeletion selected={props.selected} />
    if (props.selected.reachable.value) return <Editor selected={props.selected} />
    return <Offline selected={props.selected} />
  }

  return state.frontPage.value ? <FrontPage /> : <Results selected={state.selected.ornull} />
}

const Template = (props: { children: ComponentChildren }) => (
  <main className="align-items-center text-center align-content-center"> {props.children}</main>
)

const VieraConfigUI = () => (
  <Template>
    <Header />
    <Body />
  </Template>
)

export default VieraConfigUI
