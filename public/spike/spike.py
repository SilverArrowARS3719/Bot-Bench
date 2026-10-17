# The LEGO SPIKE Prime 3 Python API, driving the simulator instead of a real hub.
# Same module and function names as the real hub, so your program runs unchanged on both.
import sys, types, asyncio
import js
from pyodide.ffi import to_js

_b = js._bridge
_tasks = []


def _call(fn, *a):
    _b.call(fn, to_js(list(a)))


def _acall(fn, *a):
    # starts straight away (like the real hub), and can be awaited for completion
    return _b.callAsync(fn, to_js(list(a)))


def _read(i):
    return _b.read(i)


def _slot(p, k):
    return 8 + int(p) * 8 + k


def _module(name, **items):
    m = types.ModuleType(name)
    m.__dict__.update(items)
    sys.modules[name] = m
    return m


_STOPS = {0: 'coast', 1: 'brake', 2: 'hold', 3: 'coast', 4: 'coast', 5: 'brake'}


def _stop(s):
    return _STOPS.get(s, 'brake')


# ---------------------------------------------------------------- hub
class _Port:
    A, B, C, D, E, F = range(6)


class _MotionSensor:
    TOP, FRONT, RIGHT, BOTTOM, BACK, LEFT = range(6)

    def tilt_angles(self):
        return (int(_read(1)), int(_read(2)), int(_read(3)))

    def reset_yaw(self, angle=0):
        _call('resetYaw', angle / 10)

    def stable(self):
        return True


class _LightMatrix:
    def write(self, text, intensity=100, time_per_character=500):
        _call('display', str(text))

    def show_image(self, image):
        _call('display', f'[image {image}]')

    def clear(self):
        _call('display', '')

    def set_pixel(self, x, y, intensity):
        pass


class _Sound:
    def beep(self, freq=440, duration=500, volume=100):
        return _acall('beep', freq, duration, volume)

    def stop(self):
        pass


class _Button:
    LEFT, RIGHT = 1, 2

    def pressed(self, button):
        return 0


class _Light:
    POWER, CONNECT = 0, 1

    def color(self, light, color):
        pass


_module('hub', port=_Port(), motion_sensor=_MotionSensor(), light_matrix=_LightMatrix(), sound=_Sound(),
        button=_Button(), light=_Light(), temperature=lambda: 250, device_uuid=lambda: 'simulator',
        hardware_id=lambda: 'simulator', power_off=lambda: None)

_module('color', BLACK=0, MAGENTA=1, PURPLE=2, BLUE=3, AZURE=4, TURQUOISE=5, GREEN=6, YELLOW=7, ORANGE=8,
        RED=9, WHITE=10, UNKNOWN=-1)

# ---------------------------------------------------------------- motor
def _run(port, velocity, *, acceleration=1000):
    _call('motorRun', port, velocity, acceleration)


def _run_for_degrees(port, degrees, velocity, *, stop=1, acceleration=1000, deceleration=1000):
    return _acall('motorRunForDegrees', port, degrees, velocity, _stop(stop), acceleration, deceleration)


def _run_for_time(port, duration, velocity, *, stop=1, acceleration=1000, deceleration=1000):
    return _acall('motorRunForTime', port, duration, velocity, _stop(stop), acceleration)


def _run_to_relative_position(port, position, velocity, *, stop=1, acceleration=1000, deceleration=1000):
    return _acall('motorRunToRelative', port, position, velocity, _stop(stop), acceleration, deceleration)


def _absolute(port):
    return int((_read(_slot(port, 0)) + 180) % 360 - 180)


def _run_to_absolute_position(port, position, velocity, *, direction=2, stop=1, acceleration=1000, deceleration=1000):
    now = _absolute(port)
    delta = (position - now) % 360
    if direction == 2:  # SHORTEST_PATH
        delta = delta - 360 if delta > 180 else delta
    elif direction == 1:  # COUNTERCLOCKWISE
        delta = delta - 360 if delta else 0
    elif direction == 3:  # LONGEST_PATH
        delta = delta - 360 if delta <= 180 else delta
    rel = int(_read(_slot(port, 0)))
    return _acall('motorRunToRelative', port, rel + delta, abs(velocity), _stop(stop), acceleration, deceleration)


_module('motor', COAST=0, BRAKE=1, HOLD=2, CONTINUE=3, SMART_COAST=4, SMART_BRAKE=5,
        CLOCKWISE=0, COUNTERCLOCKWISE=1, SHORTEST_PATH=2, LONGEST_PATH=3,
        READY=0, RUNNING=1, STALLED=2, CANCELLED=3, ERROR=4, DISCONNECTED=5,
        run=_run, run_for_degrees=_run_for_degrees, run_for_time=_run_for_time,
        run_to_relative_position=_run_to_relative_position, run_to_absolute_position=_run_to_absolute_position,
        stop=lambda port, *, stop=1: _call('motorStop', port, _stop(stop)),
        relative_position=lambda port: int(_read(_slot(port, 0))),
        reset_relative_position=lambda port, position: _call('motorResetPosition', port, position),
        absolute_position=_absolute,
        velocity=lambda port: int(_read(_slot(port, 1))),
        set_duty_cycle=lambda port, pwm: _call('motorRun', port, pwm / 10000 * 1050, 10000),
        get_duty_cycle=lambda port: 0)

# ---------------------------------------------------------------- motor_pair
_pairs = {}


def _pair(pair, left_motor, right_motor):
    _pairs[pair] = (left_motor, right_motor)


def _lr(pair):
    if pair not in _pairs:
        raise RuntimeError('motor_pair.pair() has not been called for this pair')
    return _pairs[pair]


_module('motor_pair', PAIR_1=0, PAIR_2=1, PAIR_3=2,
        pair=_pair, unpair=lambda pair: _pairs.pop(pair, None),
        move=lambda pair, steering, *, velocity=360, acceleration=1000: _call('pairMove', *_lr(pair), steering, velocity, acceleration),
        move_for_degrees=lambda pair, degrees, steering, *, velocity=360, stop=1, acceleration=1000, deceleration=1000:
            _acall('pairMoveForDegrees', *_lr(pair), degrees, steering, velocity, _stop(stop), acceleration, deceleration),
        move_for_time=lambda pair, duration, steering, *, velocity=360, stop=1, acceleration=1000, deceleration=1000:
            _acall('pairMoveForTime', *_lr(pair), duration, steering, velocity, _stop(stop), acceleration),
        move_tank=lambda pair, left_velocity, right_velocity, *, acceleration=1000:
            _call('pairTank', *_lr(pair), left_velocity, right_velocity, acceleration),
        move_tank_for_degrees=lambda pair, degrees, left_velocity, right_velocity, *, stop=1, acceleration=1000, deceleration=1000:
            _acall('pairTankForDegrees', *_lr(pair), degrees, left_velocity, right_velocity, _stop(stop), acceleration, deceleration),
        move_tank_for_time=lambda pair, left_velocity, right_velocity, duration, *, stop=1, acceleration=1000, deceleration=1000:
            _acall('pairTankForTime', *_lr(pair), left_velocity, right_velocity, duration, _stop(stop), acceleration),
        stop=lambda pair, *, stop=1: _call('pairStop', *_lr(pair), _stop(stop)))

# ---------------------------------------------------------------- sensors
def _rgbi(port):
    packed = int(_read(_slot(port, 7)))
    r, g, b = (packed >> 16) & 255, (packed >> 8) & 255, packed & 255
    return (r * 4, g * 4, b * 4, (r + g + b) * 4 // 3)


_module('color_sensor', color=lambda port: int(_read(_slot(port, 2))),
        reflection=lambda port: int(_read(_slot(port, 3))), rgbi=_rgbi)

_module('distance_sensor', distance=lambda port: int(_read(_slot(port, 4))),
        clear=lambda port: None, get_pixel=lambda port, x, y: 0, set_pixel=lambda port, x, y, intensity: None,
        show=lambda port, pixels: None)

_module('force_sensor', force=lambda port: int(_read(_slot(port, 5)) * 10),  # decinewtons
        pressed=lambda port: bool(_read(_slot(port, 6))), raw=lambda port: int(_read(_slot(port, 5)) * 100))

# ---------------------------------------------------------------- runloop
def _run_all(*coroutines):
    for c in coroutines:
        _tasks.append(asyncio.ensure_future(c))


async def _until(function, timeout=0):
    waited = 0
    while not function():
        await _acall('wait', 10)
        waited += 10
        if timeout and waited >= timeout:
            return False
    return True


_module('runloop', run=_run_all, sleep_ms=lambda duration: _acall('wait', duration), until=_until)


async def _wait_all():
    while _tasks:
        await _tasks.pop(0)


def _reset():
    _tasks.clear()
    _pairs.clear()
