"""Send SharePoint REST calls through the 'SP Batch (HTTP)' flow.

    python scripts/sp.py <url-file> requests.json      # file holding a JSON array of {method, uri, headers?, body?}
"""
import json
import sys
import urllib.request

VERBOSE = {"Accept": "application/json;odata=verbose", "Content-Type": "application/json;odata=verbose"}
MERGE = {"Accept": "application/json;odata=nometadata", "Content-Type": "application/json;odata=nometadata",
         "X-HTTP-Method": "MERGE", "IF-MATCH": "*"}
DELETE = {"Accept": "application/json;odata=nometadata", "X-HTTP-Method": "DELETE", "IF-MATCH": "*"}


def field(list_title, xml):
    return {"method": "POST", "uri": f"_api/web/lists/getbytitle('{list_title}')/fields/createfieldasxml", "headers": VERBOSE,
            "body": {"parameters": {"__metadata": {"type": "SP.XmlSchemaFieldCreationInformation"}, "SchemaXml": xml, "Options": 24}}}


def choices(list_title, name, values):
    return {"method": "POST", "uri": f"_api/web/lists/getbytitle('{list_title}')/fields/getbyinternalnameortitle('{name}')",
            "headers": {**VERBOSE, "X-HTTP-Method": "MERGE", "IF-MATCH": "*"},
            "body": {"__metadata": {"type": "SP.FieldChoice"}, "Choices": {"__metadata": {"type": "Collection(Edm.String)"}, "results": values}}}


def merge(list_title, item_id, fields):
    return {"method": "POST", "uri": f"_api/web/lists/getbytitle('{list_title}')/items({item_id})", "headers": MERGE, "body": fields}


def delete(list_title, item_id):
    return {"method": "POST", "uri": f"_api/web/lists/getbytitle('{list_title}')/items({item_id})", "headers": DELETE}


def send(url_file, requests):
    url = open(url_file).read().strip()
    req = urllib.request.Request(url, data=json.dumps({"requests": requests}).encode(), headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read() or b"{}")


if __name__ == "__main__":
    print(send(sys.argv[1], json.load(open(sys.argv[2]))))
