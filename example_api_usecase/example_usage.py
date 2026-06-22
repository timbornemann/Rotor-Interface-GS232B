"""Minimalbeispiele fuer den RotorApiClient."""

import time

try:
    from example_api_usecase import RotorApiClient, RotorApiError, RotorDisconnectedError
except ImportError:
    from rotor_client import RotorApiClient, RotorApiError, RotorDisconnectedError


def main() -> None:
    client = RotorApiClient(host="localhost", http_port=8081)

    try:
        print("Session:", client.ensure_session())
        print("Ports:", client.list_ports())
        print("Status:", client.get_status())
        time.sleep(1.0)
        print("Cached status:", client.current_status)
        print("Cached position:", client.current_position)
        print("Recent events:", client.get_recent_events())

        # Beispiel fuer echte Steuerung:
        # client.connect("COM3", baud_rate=9600)
        # client.set_target_async(az=180, el=45)
        # client.stop()
    except RotorDisconnectedError as exc:
        print("Rotor ist nicht verbunden:", exc)
    except RotorApiError as exc:
        print("API-Fehler:", exc)
    finally:
        client.close()


if __name__ == "__main__":
    main()
