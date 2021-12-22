import { faTv, faCartPlus, faTrash } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { IHomebridgeUiFormHelper } from '@homebridge/plugin-ui-utils/dist/ui.interface'
import { createState, useState } from '@hookstate/core'
import { JSX } from 'preact'
import { useEffect } from 'preact/hooks'
import { Alert, Button, Form, Spinner } from 'react-bootstrap'

import { UserConfig } from '../accessory'
import { sleep, isEmpty, isValidIPv4 } from '../helpers'
import { VieraAuth, VieraSpecs } from '../viera'

import {
  authLayout,
  commonFormLayout,
  commonSchema,
  tvAddressSchema,
  pinRequestSchema
} from './forms'
import { Header } from './imagery'
import { getUntrackedObject, InitialState } from './state'

const globalState = createState(InitialState)

const enum UIServerRequestErrorType {
  NotConnectable,
  AuthFailed,
  PinChallengeError,
  WrongPin
}

interface UIServerRequestError {
  message: string
  error: UIServerRequestErrorType
}

const { homebridge } = window

const updateGlobalConfig = async (): Promise<void> =>
  globalState.config.set((await homebridge.getPluginConfig())[0])

const Body = (): JSX.Element => {
  const state = useState(globalState)

  useEffect(() => void (async (): Promise<void> => updateGlobalConfig())(), [])

  const previousConfig = (ip: string) =>
    state.config.get().tvs.find((o: UserConfig) => o.ipAddress === ip)

  const backToMain = (form?: IHomebridgeUiFormHelper) => {
    if (form) form.end()
    state.frontPage.set(true)
    state.selected.set({})
  }

  const onEdition = async (raw?: string): Promise<void> => {
    let wait = true
    const pair = (challenge: string) => {
      const pinForm = homebridge.createForm(pinRequestSchema, null, 'Next', 'Cancel')
      pinForm.onCancel(() => pinForm.end())
      pinForm.onSubmit(
        async (data) =>
          await homebridge
            .request('/pair', { challenge, ip: tv.ipAddress, pin: data.pin })
            .then(async (auth: VieraAuth) => {
              const specs: VieraSpecs = await homebridge.request(
                '/specs',
                JSON.stringify({ ...tv, appId: auth.appId, encKey: auth.key })
              )
              return { auth, specs }
            })
            .then((payload) =>
              state['selected'].merge({
                config: { ...tv, appId: payload.auth.appId, encKey: payload.auth.key },
                specs: payload.specs
              })
            )
            .catch(() => {
              homebridge.toast.error('Wrong PIN...', tv.ipAddress)
              backToMain()
            })
            .finally(() => pinForm.end())
      )
    }

    if (!raw) {
      state.frontPage.set(false)
      const newTvForm = homebridge.createForm(tvAddressSchema, null, 'Next', 'Cancel')
      newTvForm.onCancel(() => backToMain(newTvForm))

      newTvForm.onSubmit(async (data) => {
        if (isValidIPv4(data.ipAddress)) {
          if (previousConfig(data.ipAddress))
            homebridge.toast.error('Trying to setup an already configured TV set!', data.ipAddress)
          else {
            state['selected'].merge({ config: { hdmiInputs: [], ipAddress: data.ipAddress } })
            newTvForm.end()
            wait = false
          }
        } else homebridge.toast.error('Please insert a valid IP address...', data.ipAddress)
      })
    } else {
      state['selected'].merge({ config: JSON.parse(raw) })
      wait = false
    }
    while (wait) await sleep(200)
    const tv = getUntrackedObject(state['selected'].get().config)
    const reachable = await homebridge.request('/ping', tv.ipAddress)
    state['selected'].merge({ config: tv, reachable })
    state.frontPage.set(false)

    if (reachable) {
      const defaultClosure = (specs: VieraSpecs) => {
        state['selected'].merge({ specs })
        return true
      }
      const done = await homebridge
        .request('/specs', JSON.stringify(tv))
        .then(async (specs) => defaultClosure(specs))
        .catch(() => false)

      if (!done)
        await homebridge
          .request('/pin', tv.ipAddress)
          .then((challenge) => pair(challenge))
          .catch(() => defaultClosure({}))
    }
  }

  const onDeletion = (raw: string): void => {
    state.frontPage.set(false)
    state['selected'].merge({ config: JSON.parse(raw) })
  }

  const FrontPage = () => {
    const available = getUntrackedObject(state.config.get().tvs as UserConfig[])
    const killSwitch = state.killSwitch
    const flipKillSwitch = () => killSwitch.set(!killSwitch.get())

    const label = `${killSwitch.get() ? 'deletion' : 'edition'} mode`
    const ButtonCSS = { height: '4em', width: '10em' }
    const icon = killSwitch.get() ? faTrash : faTv
    const fn = (tv: string) => (killSwitch.get() ? onDeletion(tv) : onEdition(tv))
    const AvailableTVs = () =>
      available &&
      (available as UserConfig[]).map((tv, idx) => (
        <Button
          variant={killSwitch.get() ? 'danger' : 'info'}
          style={ButtonCSS}
          key={idx}
          onClick={() => fn(JSON.stringify(tv))}
        >
          <FontAwesomeIcon fixedWidth size="lg" icon={icon} />
          <br /> {tv.ipAddress}
        </Button>
      ))
    const AddNewTvButton = () =>
      killSwitch.get() ? null : (
        <div className="d-flex justify-content-center mt-3 mb-5">
          <Button className="my-4" variant="primary" onClick={() => onEdition()} style={ButtonCSS}>
            <FontAwesomeIcon fixedWidth size="sm" icon={faTv} />
            <br /> <FontAwesomeIcon fixedWidth size="lg" icon={faCartPlus} />
          </Button>
        </div>
      )

    return (
      <section style={{ minHeight: '25em' }}>
        <Form className="d-flex justify-content-end mt-3 mb-5">
          <Form.Switch onChange={flipKillSwitch} id="kS" label={label} checked={killSwitch.get()} />
        </Form>
        <AvailableTVs />
        <AddNewTvButton />
      </section>
    )
  }

  const Results = () => {
    const IsOffline = () => (
      <Alert variant="danger" className="mt-3">
        <Alert.Heading>
          The Viera TV at <b>{state.selected.config.ipAddress.get()}</b> could not be reached.
        </Alert.Heading>
        <hr />
        <p className="mb-2">
          Please, do make sure that it is <b>turned on</b> and <b>connected to the network</b>, and
          then try again.
        </p>
        <div className="d-flex justify-content-end mt-5">
          <Button onClick={() => backToMain()} variant="primary" style={{ width: '15em' }}>
            OK
          </Button>
        </div>
      </Alert>
    )

    const AreWeSure = () => {
      const dropIt = async () => {
        const target = state.selected.config.ipAddress.get()
        const remaining = getUntrackedObject(
          state.config.get().tvs.filter((o: UserConfig) => o.ipAddress !== target)
        )
        await homebridge.updatePluginConfig([{ platform: 'PanasonicVieraTV', tvs: [...remaining] }])
        await homebridge.savePluginConfig()
        updateGlobalConfig()
        homebridge.toast.success(`${target} deleted`)
        backToMain()
      }
      return (
        <Alert variant="danger" className="mt-3">
          <Alert.Heading>
            The Viera TV at <b>{state.selected.config.ipAddress.get()}</b> is about to be deleted
            from this Homebridge.
          </Alert.Heading>
          <hr />
          <p className="mb-2">Please, make sure you know what you are doing....</p>
          <div className="d-flex justify-content-end mt-5">
            <Button onClick={() => backToMain()} variant="primary" style={{ width: '15em' }}>
              Cancel
            </Button>
            <Button onClick={dropIt} variant="danger" style={{ width: '15em' }}>
              Delete
            </Button>
          </div>
        </Alert>
      )
    }

    const Editor = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const equals = (a: any, b: any): boolean => {
        if (a === b) return true
        if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
        if (!a || !b || (typeof a !== 'object' && typeof b !== 'object')) return a === b
        if (a.prototype !== b.prototype) return false
        const keys = Object.keys(a)
        if (keys.length !== Object.keys(b).length) return false
        return keys.every((k) => equals(a[k], b[k]))
      }

      if (state.selected.specs.requiresEncryption.get()) commonFormLayout.splice(1, 0, authLayout)

      const tvform = homebridge.createForm(
        { layout: commonFormLayout, schema: commonSchema },
        getUntrackedObject(state.selected.config.value),
        'Submit',
        'Cancel'
      )

      tvform.onCancel(() => backToMain(tvform))

      tvform.onSubmit(async (change) => {
        const previous = previousConfig(change.ipAddress)
        const changed = previous != null
        if (changed && equals(previous, change))
          homebridge.toast.info('No changes were made.', change.ipAddress)
        else {
          const remaining = changed
            ? getUntrackedObject(state.config.get().tvs.filter((v: UserConfig) => v != previous))
            : []
          await homebridge.updatePluginConfig([
            { platform: 'PanasonicVieraTV', tvs: [...remaining, change] }
          ])
          await homebridge.savePluginConfig()
          updateGlobalConfig()
          homebridge.toast.success(`${change.ipAddress} ${changed ? 'changed' : 'added.'}`)
        }
        backToMain(tvform)
      })

      return <></>
    }

    if (isEmpty(getUntrackedObject(state.selected.value)))
      return <Spinner animation="border" variant="primary" />

    if (state.killSwitch.get() && !isEmpty(getUntrackedObject(state['selected'].get())))
      return <AreWeSure />

    if (!state.selected.get().reachable && state.selected.get().config?.ipAddress)
      return <IsOffline />

    if (!state.selected.get().specs) return <Spinner animation="border" variant="primary" />

    return <Editor />
  }

  return state.frontPage.get() ? <FrontPage /> : <Results />
}

const Template = (props: { children: preact.ComponentChild | preact.ComponentChildren }) => (
  <main className="align-items-center text-center align-content-center">{props.children}</main>
)

const VieraConfigUI = () => (
  <>
    <Header />
    <Template>
      <Body />
    </Template>
  </>
)

export default VieraConfigUI
export { UIServerRequestError, UIServerRequestErrorType }