import { faTv, faCartPlus, faTrash } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { createState, useState } from '@hookstate/core'
import { JSX } from 'preact'
import { useEffect } from 'preact/compat'
import { Alert, Button, Form } from 'react-bootstrap'

import { UserConfig } from '../accessory'
import { sleep, isEmpty, isValidIPv4, Abnormal, dupeChecker } from '../helpers'
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

const enum actionType {
  create = 'added',
  update = 'changed',
  delete = 'deleted',
  none = 'unchanged'
}

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

const updateGlobalConfig = async (): Promise<void> => {
  const current = (await homebridge.getPluginConfig())[0]
  current.tvs ??= []
  if (Abnormal(dupeChecker(current.tvs))) {
    globalState.abnormal.set(true)
    globalState.killSwitch.set(true)
  } else {
    globalState.abnormal.set(false)
    globalState.killSwitch.set(false)
  }

  globalState.config.set(current)
}

const updateHomebridgeConfig = async (ip: string, next: UserConfig[], type: actionType) => {
  await homebridge.updatePluginConfig([{ platform: 'PanasonicVieraTV', tvs: [...next] }])
  await homebridge.savePluginConfig()
  await updateGlobalConfig()
  homebridge.toast.success(`${ip} ${type}.`)
}

const Body = (): JSX.Element => {
  const state = useState(globalState)

  useEffect(() => void (async (): Promise<void> => updateGlobalConfig())(), [])

  const previousConfig = (ip: string) =>
    state.config.get().tvs.find((o: UserConfig) => o.ipAddress === ip)

  const backToMain = () => {
    state.selected.set({})
    state.frontPage.set(true)
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
              homebridge.showSpinner()
              const specs: VieraSpecs = await homebridge.request(
                '/specs',
                JSON.stringify({ ...tv, appId: auth.appId, encKey: auth.key })
              )
              homebridge.hideSpinner()
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
      newTvForm.onCancel(() => {
        newTvForm.end()
        backToMain()
      })

      newTvForm.onSubmit(async (data) => {
        if (isValidIPv4(data.ipAddress)) {
          if (previousConfig(data.ipAddress))
            homebridge.toast.error(
              'Trying to add as new  an already configured TV set!',
              data.ipAddress
            )
          else {
            newTvForm.end()
            state['selected'].merge({ config: { hdmiInputs: [], ipAddress: data.ipAddress } })
            wait = false
          }
        } else homebridge.toast.error('Please insert a valid IP address...', data.ipAddress)
      })
    } else {
      state['selected'].merge({ config: JSON.parse(raw) })
      wait = false
    }
    while (wait) await sleep(200)
    homebridge.showSpinner()
    const tv = getUntrackedObject(state['selected'].get().config)
    const reachable = await homebridge.request('/ping', tv.ipAddress)
    homebridge.hideSpinner()
    state['selected'].merge({ config: tv, reachable })
    state.frontPage.set(false)

    if (reachable) {
      const defaultClosure = (specs: VieraSpecs) => {
        state['selected'].merge({ specs })
        return true
      }
      homebridge.showSpinner()
      const done = await homebridge
        .request('/specs', JSON.stringify(tv))
        .then(async (specs) => defaultClosure(specs))
        .catch(() => false)
      homebridge.hideSpinner()
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
    const flipKillSwitch = () => {
      if (!state.abnormal.get()) killSwitch.set(!killSwitch.get())
    }

    const label = `${killSwitch.get() ? 'deletion' : 'edition'} mode`
    const ButtonCSS = { height: '4em', width: '10em' }
    const icon = killSwitch.get() ? faTrash : faTv
    const fn = (tv: string) => (killSwitch.get() ? onDeletion(tv) : onEdition(tv))
    const KillBox = () => {
      return state.abnormal.get() ? (
        <Alert variant="warning" className="d-flex justify-content-center mt-3 mb-5">
          <strong>
            more than one TV with same IP address found: please delete the bogus ones!
          </strong>
        </Alert>
      ) : available?.length != 0 ? (
        <Form className="d-flex justify-content-end mt-3 mb-5">
          <Form.Switch onChange={flipKillSwitch} id="kS" label={label} checked={killSwitch.get()} />
        </Form>
      ) : null
    }
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
        <KillBox />
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
        await updateHomebridgeConfig(target, remaining, actionType.delete)
        backToMain()
      }
      return (
        <Alert variant="danger" className="mt-3">
          <Alert.Heading>
            The Viera TV at <b>{state.selected.config.ipAddress.get()}</b> is about to be deleted
            from this Homebridge.
          </Alert.Heading>
          <hr />
          <div className="d-flex justify-content-center">
            <div className="w-75">
              <p className="mb-2">Please, make sure you know what you are doing...</p>
              <hr />
              <pre class="text-monospace text-left bg-light p-2">
                {JSON.stringify(state.selected.config.get(), undefined, 2)}
              </pre>
              <hr />
            </div>
          </div>
          <div className="d-flex justify-content-end mt-1">
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

      tvform.onCancel(() => {
        tvform.end()
        backToMain()
      })

      tvform.onSubmit(async (incoming) => {
        homebridge.showSpinner()
        tvform.end()
        backToMain()
        const z = incoming.ipAddress
        const before = previousConfig(z)
        let others: UserConfig[] = []
        let type = actionType.none
        if (!equals(before, incoming)) {
          const modded = before != null
          others = modded
            ? getUntrackedObject(state.config.get().tvs.filter((v: UserConfig) => v.ipAddress != z))
            : []
          type = modded ? actionType.update : actionType.create
        }
        await updateHomebridgeConfig(z, [...others, incoming as UserConfig], type)
        homebridge.hideSpinner()
      })
      return null
    }

    if (isEmpty(getUntrackedObject(state.selected.value))) return <></>

    if (state.killSwitch.get() && !isEmpty(getUntrackedObject(state['selected'].get())))
      return <AreWeSure />

    if (!state.selected.get().reachable && state.selected.get().config?.ipAddress)
      return <IsOffline />

    if (!state.selected.get().specs) return <></>

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
